import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../AuthProvider";
import { useAuth } from "../auth-context";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../api";

const apiGet = vi.fn();
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, apiGet: (...args: unknown[]) => apiGet(...args) };
});

function Probe() {
  const { user, loading } = useAuth();
  const { logout } = useAuth();
  return (
    <div>
      <p>{loading ? "loading" : (user?.email ?? "none")}</p>
      <button onClick={logout}>out</button>
    </div>
  );
}

function renderProvider() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AuthProvider session restore", () => {
  beforeEach(() => {
    apiGet.mockReset();
    sessionStorage.clear();
    sessionStorage.setItem("access_token", "access");
    sessionStorage.setItem("refresh_token", "refresh");
  });

  it("forgets the tokens when the server rejects /me", async () => {
    apiGet.mockRejectedValue(new ApiError("API error 500", 500));
    renderProvider();
    await waitFor(() => expect(screen.getByText("none")).toBeInTheDocument());
    expect(sessionStorage.getItem("access_token")).toBeNull();
  });

  it("keeps the tokens when /me fails without an answer (aborted while leaving the page)", async () => {
    apiGet.mockRejectedValue(new TypeError("Failed to fetch"));
    renderProvider();
    await waitFor(() => expect(screen.getByText("none")).toBeInTheDocument());
    expect(sessionStorage.getItem("access_token")).toBe("access");
    expect(sessionStorage.getItem("refresh_token")).toBe("refresh");
  });
});

describe("AuthProvider logout", () => {
  it("revokes the refresh token on the server, then clears the tokens, even when the network fails", async () => {
    sessionStorage.clear();
    sessionStorage.setItem("access_token", "access");
    sessionStorage.setItem("refresh_token", "refresh-7");
    apiGet.mockResolvedValue({ id: "u1", email: "a@b.de", language: "de" });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();
    await waitFor(() => expect(screen.getByText("a@b.de")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "out" }));

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/auth\/logout$/);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      refresh_token: "refresh-7",
    });
    await waitFor(() => expect(screen.getByText("none")).toBeInTheDocument());
    expect(sessionStorage.getItem("refresh_token")).toBeNull();
    expect(sessionStorage.getItem("access_token")).toBeNull();
    vi.unstubAllGlobals();
  });
});
