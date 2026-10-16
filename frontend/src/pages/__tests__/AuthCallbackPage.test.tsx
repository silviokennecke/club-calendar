import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import AuthCallbackPage from "../AuthCallbackPage";
import { renderAt } from "./authTestUtils";

vi.mock("@/lib/api", () => ({ storeTokens: vi.fn(), apiGet: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login: vi.fn() }) }));

beforeEach(() => vi.clearAllMocks());

function renderCallback(search: string) {
  return renderAt(`/auth/callback${search}`, "/auth/callback", <AuthCallbackPage />);
}

describe("AuthCallbackPage", () => {
  it("sends email_verification_required with an address to the code page", async () => {
    renderCallback("?error=email_verification_required&email=alex%40beispiel.de");
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/verify-email?email=alex%40beispiel.de",
    );
  });

  it("sends other errors to the login with the code", async () => {
    renderCallback("?error=provider_denied");
    expect(await screen.findByTestId("location")).toHaveTextContent("/login?error=provider_denied");
  });

  it("keeps email_verification_required without an address on the login", async () => {
    renderCallback("?error=email_verification_required");
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/login?error=email_verification_required",
    );
  });
});
