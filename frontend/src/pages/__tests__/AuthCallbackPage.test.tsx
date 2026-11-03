import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import AuthCallbackPage from "../AuthCallbackPage";
import { ApiError, apiGet, exchangeOneTimeToken, storeTokens } from "@/lib/api";
import { renderAt } from "./authTestUtils";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  storeTokens: vi.fn(),
  apiGet: vi.fn(),
  exchangeOneTimeToken: vi.fn(),
}));
const login = vi.fn();
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login }) }));

const user = { id: "u1", email: "a@b.de" };

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
  sessionStorage.setItem("sso_code_verifier", "verifier-1");
});

function renderCallback(search: string) {
  return renderAt(`/auth/callback${search}`, "/auth/callback", <AuthCallbackPage />);
}

describe("AuthCallbackPage", () => {
  it("sends other errors to the login with the code", async () => {
    renderCallback("?error=provider_denied");
    expect(await screen.findByTestId("location")).toHaveTextContent("/login?error=provider_denied");
  });

  it("exchanges the code, stores the tokens and continues to /clubs", async () => {
    vi.mocked(exchangeOneTimeToken).mockResolvedValue({
      access_token: "acc",
      refresh_token: "ref",
      user,
    } as never);
    vi.mocked(apiGet).mockResolvedValue(user);
    renderCallback("?code=abc");
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs");
    expect(exchangeOneTimeToken).toHaveBeenCalledTimes(1);
    expect(exchangeOneTimeToken).toHaveBeenCalledWith("abc", "verifier-1");
    expect(sessionStorage.getItem("sso_code_verifier")).toBeNull();
    expect(storeTokens).toHaveBeenCalledWith("acc", "ref");
    expect(login).toHaveBeenCalledWith("acc", "ref", user);
  });

  it("continues at the verify page for a restricted session", async () => {
    const restricted = { ...user, emailVerificationRequired: true };
    vi.mocked(exchangeOneTimeToken).mockResolvedValue({
      access_token: "acc",
      refresh_token: "ref",
      user: restricted,
      emailVerificationRequired: true,
    } as never);
    vi.mocked(apiGet).mockResolvedValue(restricted);
    renderCallback("?code=abc");
    expect(await screen.findByTestId("location")).toHaveTextContent("/verify-email");
    expect(login).toHaveBeenCalledWith("acc", "ref", restricted);
  });

  it("removes the code from the address bar before the exchange", async () => {
    window.history.replaceState(null, "", "/auth/callback?code=abc");
    let urlAtExchange = "";
    vi.mocked(exchangeOneTimeToken).mockImplementation(() => {
      urlAtExchange = window.location.pathname + window.location.search;
      return Promise.reject(new ApiError("x", 400, "invalid_grant"));
    });
    renderCallback("?code=abc");
    await screen.findByTestId("location");
    expect(urlAtExchange).toBe("/auth/callback");
  });

  it("redeems the code only once when the effect runs twice (StrictMode)", async () => {
    vi.mocked(exchangeOneTimeToken).mockResolvedValue({
      access_token: "acc",
      refresh_token: "ref",
      user,
    } as never);
    vi.mocked(apiGet).mockResolvedValue(user);
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/auth/callback?code=abc"]}>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="*" element={<div>done</div>} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    await screen.findByText("done");
    expect(exchangeOneTimeToken).toHaveBeenCalledTimes(1);
  });

  it("shows the invalid-code error for a rejected code", async () => {
    vi.mocked(exchangeOneTimeToken).mockRejectedValue(new ApiError("x", 400, "invalid_grant"));
    renderCallback("?code=used");
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/login?error=invalid_login_code",
    );
    expect(storeTokens).not.toHaveBeenCalled();
  });

  it("does not redeem without the verifier of this tab (another tab or browser)", async () => {
    sessionStorage.clear();
    renderCallback("?code=abc");
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/login?error=invalid_code_verifier",
    );
    expect(exchangeOneTimeToken).not.toHaveBeenCalled();
    expect(storeTokens).not.toHaveBeenCalled();
  });

  it("shows the browser-binding error when the backend rejects the verifier", async () => {
    vi.mocked(exchangeOneTimeToken).mockRejectedValue(
      new ApiError("x", 400, "invalid_code_verifier"),
    );
    renderCallback("?code=abc");
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/login?error=invalid_code_verifier",
    );
    expect(sessionStorage.getItem("sso_code_verifier")).toBeNull();
  });

  it("reports other failures as oauth_failed", async () => {
    vi.mocked(exchangeOneTimeToken).mockRejectedValue(new TypeError("network"));
    renderCallback("?code=abc");
    expect(await screen.findByTestId("location")).toHaveTextContent("/login?error=oauth_failed");
  });

  it("ignores the former token query parameters", async () => {
    renderCallback("?token=a&refresh_token=b");
    expect(await screen.findByTestId("location")).toHaveTextContent("/login?error=oauth_failed");
    expect(exchangeOneTimeToken).not.toHaveBeenCalled();
    expect(storeTokens).not.toHaveBeenCalled();
  });
});
