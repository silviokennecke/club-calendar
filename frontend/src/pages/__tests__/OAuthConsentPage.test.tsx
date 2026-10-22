import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "@/lib/api";
import OAuthConsentPage from "../OAuthConsentPage";

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));
const assign = vi.fn();
vi.mock("@/lib/mcp", async (orig) => ({
  ...(await orig<typeof import("@/lib/mcp")>()),
  navigateAway: { to: (u: string) => assign(u) },
}));
vi.mock("@/components/legal/LegalLinks", () => ({ LegalLinks: () => null }));

const base = {
  id: "r1",
  clientName: "Mein Assistent",
  redirectHost: "claude.ai",
  family: "claude",
  scopes: ["mcp:read"],
  createdAt: "2026-10-22T10:00:00Z",
  expiresAt: "2999-01-01T00:00:00Z",
};

async function renderPage(url = "/oauth/consent?request=r1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <OAuthConsentPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(base);
});

describe("OAuthConsentPage", () => {
  it("shows client, redirect host and read scope without an unverified notice", async () => {
    await renderPage();
    expect(await screen.findByText("Mein Assistent", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("claude.ai")).toBeInTheDocument();
    expect(
      screen.getByText(/Vereine, Kalender, Termine, Vorlagen und Feeds ansehen/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Terminentwürfe/)).not.toBeInTheDocument();
    expect(screen.queryByText("Nicht verifizierte App")).not.toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/oauth/authorization-request/r1");
  });

  it("warns about unverified apps and lists write rights", async () => {
    apiGet.mockResolvedValue({ ...base, family: null, scopes: ["mcp:read", "mcp:write"] });
    await renderPage();
    expect(await screen.findByText("Nicht verifizierte App")).toBeInTheDocument();
    expect(screen.getByText(/Terminentwürfe/)).toBeInTheDocument();
  });

  it("allows and follows the redirect URL", async () => {
    apiPost.mockResolvedValue({ redirectUrl: "https://claude.ai/cb?code=x" });
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Erlauben" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=x"));
    expect(apiPost).toHaveBeenCalledWith("/api/oauth/authorize/decision", {
      requestId: "r1",
      approve: true,
    });
  });

  it("denies", async () => {
    apiPost.mockResolvedValue({ redirectUrl: "https://claude.ai/cb?error=access_denied" });
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Ablehnen" }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith("/api/oauth/authorize/decision", {
      requestId: "r1",
      approve: false,
    });
  });

  it.each([
    ["quota_exceeded", /maximale Zahl verbundener Apps/],
    ["email_not_verified", /E-Mail-Adresse/],
    ["consent_required", /aktuellen Dokumenten/],
    ["rate_limited", /Zu viele Versuche/],
  ])("maps %s", async (code, text) => {
    apiPost.mockRejectedValue(new ApiError("x", 403, code));
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Erlauben" }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows the expired state for an unknown request", async () => {
    apiGet.mockRejectedValue(new ApiError("x", 404, "authorization_request_not_found"));
    await renderPage();
    expect(await screen.findByText("Anfrage abgelaufen")).toBeInTheDocument();
  });

  it("shows the expired state without a request id", async () => {
    await renderPage("/oauth/consent");
    expect(await screen.findByText("Anfrage abgelaufen")).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("offers a retry on a load error", async () => {
    apiGet.mockRejectedValueOnce(new Error("network"));
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByText("Mein Assistent", { selector: "dd" })).toBeInTheDocument();
  });
});
