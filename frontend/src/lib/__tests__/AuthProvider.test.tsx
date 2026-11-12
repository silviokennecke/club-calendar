import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../AuthProvider";
import { useAuth } from "../auth-context";
import userEvent from "@testing-library/user-event";
import { ApiError, clearTokens, getAccessToken, storeTokens, resetAuthSyncForTests } from "../api";
import {
  announceBackupCodeUsed,
  dismissBackupCodeNotice,
  usePendingBackupCodeNotice,
} from "../backupCodeNotice";
import { FakeBroadcastChannel } from "./authTestUtils";

const apiGet = vi.fn();
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, apiGet: (...args: unknown[]) => apiGet(...args) };
});

function Probe() {
  const { user, loading, logout } = useAuth();
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
    clearTokens();
    storeTokens("access", "refresh");
  });

  it.each([401, 403])("forgets the tokens when the server rejects /me with %i", async (status) => {
    apiGet.mockRejectedValue(new ApiError(`API error ${status}`, status));
    renderProvider();
    await waitFor(() => expect(screen.getByText("none")).toBeInTheDocument());
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a network error", () => new TypeError("Failed to fetch")],
    ["a 500", () => new ApiError("API error 500", 500)],
    ["a 429", () => new ApiError("API error 429", 429)],
  ])("keeps the tokens and retries after %s", async (_name, make) => {
    apiGet.mockImplementation(() => Promise.reject(make()));
    renderProvider();
    await waitFor(() => expect(screen.getByText("none")).toBeInTheDocument(), { timeout: 4000 });
    expect(apiGet).toHaveBeenCalledTimes(3);
    expect(getAccessToken()).toBe("access");
    expect(localStorage.getItem("refresh_token")).toBe("refresh");
  });

  it("signs in when a retry succeeds", async () => {
    apiGet
      .mockRejectedValueOnce(new ApiError("API error 500", 500))
      .mockResolvedValue({ id: "u1", email: "a@b.de", language: "de" });
    renderProvider();
    await waitFor(() => expect(screen.getByText("a@b.de")).toBeInTheDocument(), { timeout: 3000 });
  });

  it("ignores a late /me rejection after the user signed out", async () => {
    let reject: (e: unknown) => void = () => {};
    apiGet.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderProvider();
    await userEvent.click(screen.getByRole("button", { name: "out" }));
    storeTokens("new", "refresh-new");
    reject(new ApiError("API error 401", 401));
    await new Promise((r) => setTimeout(r, 20));
    expect(getAccessToken()).toBe("new");
  });
});

describe("AuthProvider logout", () => {
  it("revokes the refresh token on the server, then clears the tokens, even when the network fails", async () => {
    clearTokens();
    storeTokens("access", "refresh-7");
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
    expect(localStorage.getItem("refresh_token")).toBeNull();
    expect(getAccessToken()).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("AuthProvider startup and cross-tab sync", () => {
  beforeEach(() => {
    apiGet.mockReset();
    clearTokens();
    FakeBroadcastChannel.install();
    resetAuthSyncForTests();
  });

  it("with only a refresh token: refreshes first, then loads /me", async () => {
    localStorage.setItem("refresh_token", "r1");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    apiGet.mockImplementation(async () => {
      expect(getAccessToken()).toBe("a2");
      return { id: "u1", email: "a@b.de", language: "de" };
    });
    renderProvider();
    expect(screen.getByText("loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("a@b.de")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("refresh_token")).toBe("r2");
    vi.unstubAllGlobals();
  });

  it("signs out when another tab logs out", async () => {
    storeTokens("access", "refresh");
    apiGet.mockResolvedValue({ id: "u1", email: "a@b.de", language: "de" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();
    await waitFor(() => expect(screen.getByText("a@b.de")).toBeInTheDocument());

    FakeBroadcastChannel.external().postMessage({ type: "logout" });
    await waitFor(() => expect(screen.getByText("none")).toBeInTheDocument());
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

function NoticeProbe() {
  const pending = usePendingBackupCodeNotice();
  return <p>{pending ? `notice:${pending.userId}` : "no-notice"}</p>;
}

describe("AuthProvider and the backup-code notice", () => {
  beforeEach(() => {
    apiGet.mockReset();
    clearTokens();
    storeTokens("access", "refresh");
    FakeBroadcastChannel.install();
    resetAuthSyncForTests();
    dismissBackupCodeNotice();
    apiGet.mockResolvedValue({ id: "u1", email: "a@b.de", language: "de" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  });

  function renderBoth() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
          <NoticeProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );
  }

  it("keeps the notice of the signed-in user", async () => {
    renderBoth();
    await waitFor(() => expect(screen.getByText("a@b.de")).toBeInTheDocument());
    act(() => announceBackupCodeUsed("u1", 3));
    await waitFor(() => expect(screen.getByText("notice:u1")).toBeInTheDocument());
  });

  it("drops the notice on logout", async () => {
    renderBoth();
    await waitFor(() => expect(screen.getByText("a@b.de")).toBeInTheDocument());
    act(() => announceBackupCodeUsed("u1", 3));
    await userEvent.click(screen.getByRole("button", { name: "out" }));
    await waitFor(() => expect(screen.getByText("no-notice")).toBeInTheDocument());
  });

  it("drops the notice when another tab logs out", async () => {
    renderBoth();
    await waitFor(() => expect(screen.getByText("a@b.de")).toBeInTheDocument());
    act(() => announceBackupCodeUsed("u1", 3));
    FakeBroadcastChannel.external().postMessage({ type: "logout" });
    await waitFor(() => expect(screen.getByText("no-notice")).toBeInTheDocument());
  });
});
