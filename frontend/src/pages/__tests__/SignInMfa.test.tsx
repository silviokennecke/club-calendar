import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import SignInPage from "../SignInPage";
import { ApiError } from "@/lib/api";
import { renderAt } from "./authTestUtils";

const apiPost = vi.fn();
const apiGet = vi.fn();
const login = vi.fn();
const startAuthentication = vi.fn();

vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api")>("@/lib/api")),
  BACKEND_URL: "http://api.test",
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiFetch: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login }) }));
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: (...a: unknown[]) => startAuthentication(...a),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));

const user = { id: "u1", email: "alex@beispiel.de", name: "Alex" };
const tokens = { access_token: "acc", refresh_token: "ref", user };

function challenge(methods: string[] = ["totp", "backup_code", "passkey"]) {
  return { mfaRequired: true, mfaToken: "mfa.tok", expiresIn: 300, methods };
}

function setup(methods?: string[], verify?: (path: string) => unknown) {
  apiGet.mockImplementation((path: string) =>
    Promise.resolve(
      path === "/api/auth/registration"
        ? { restricted: false }
        : { imprint: null, privacy: null, terms: null },
    ),
  );
  apiPost.mockImplementation((path: string, body: { email?: string }) => {
    if (path === "/api/auth/identify")
      return Promise.resolve({ email: body.email, status: "login" });
    if (path === "/api/auth/login") return Promise.resolve(challenge(methods));
    const r = verify?.(path);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r ?? {});
  });
}

async function toMfaStep() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderAt(
    "/login",
    "/login",
    <QueryClientProvider client={qc}>
      <SignInPage />
    </QueryClientProvider>,
  );
  const u = userEvent.setup();
  await u.type(screen.getByLabelText(/^E-Mail/), "alex@beispiel.de");
  await u.click(screen.getByRole("button", { name: "Weiter" }));
  await u.type(await screen.findByLabelText(/^Passwort$/), "secret-pw-123");
  await u.click(screen.getByRole("button", { name: "Anmelden" }));
  await screen.findByRole("form", { name: "Bestätigung mit MFA" });
  return u;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) }));
});

describe("MFA step", () => {
  it("signs in with a TOTP code", async () => {
    setup(undefined, () => tokens);
    const u = await toMfaStep();
    const input = screen.getByLabelText(/Code aus der Authenticator-App/);
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    await u.type(input, "123456");
    await u.click(screen.getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("acc", "ref", user));
    expect(apiPost).toHaveBeenCalledWith("/api/auth/mfa/verify", {
      mfaToken: "mfa.tok",
      method: "totp",
      code: "123456",
    });
  });

  it("signs in with a backup code and announces that MFA was turned off", async () => {
    const success = vi.spyOn(toast, "success");
    setup(undefined, () => ({ ...tokens, mfaDisabled: true }));
    const u = await toMfaStep();
    await u.click(screen.getByRole("button", { name: "Backup-Code verwenden" }));
    await u.type(screen.getByLabelText("Backup-Code"), "abcd-efgh");
    await u.click(screen.getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("acc", "ref", user));
    expect(apiPost).toHaveBeenCalledWith(
      "/api/auth/mfa/verify",
      expect.objectContaining({ method: "backup_code", code: "abcd-efgh" }),
    );
    expect(success).toHaveBeenCalled();
  });

  it("offers the passkey button only when the account has a passkey", async () => {
    setup(["totp", "backup_code"]);
    await toMfaStep();
    expect(screen.queryByRole("button", { name: "Passkey verwenden" })).toBeNull();
  });

  it("signs in with a passkey", async () => {
    startAuthentication.mockResolvedValue({ id: "cred" });
    setup(undefined, (path) =>
      path === "/api/auth/mfa/passkey/options"
        ? { options: { challenge: "c" }, challengeToken: "ct" }
        : tokens,
    );
    const u = await toMfaStep();
    await u.click(screen.getByRole("button", { name: "Passkey verwenden" }));
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith("/api/auth/mfa/passkey/verify", {
      mfaToken: "mfa.tok",
      challengeToken: "ct",
      response: { id: "cred" },
    });
  });

  it("returns to the password step when the token has expired", async () => {
    setup(undefined, () => new ApiError("expired", 401, "invalid_mfa_token"));
    const u = await toMfaStep();
    await u.type(screen.getByLabelText(/Code aus der Authenticator-App/), "123456");
    await u.click(screen.getByRole("button", { name: "Bestätigen" }));
    expect(await screen.findByText("Anmeldung abgelaufen")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Passwort$/)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("shows the rate limit text", async () => {
    const err = new ApiError("slow", 429, "rate_limited", undefined, { retryAfter: 120 });
    setup(undefined, () => err);
    const u = await toMfaStep();
    await u.type(screen.getByLabelText(/Code aus der Authenticator-App/), "123456");
    await u.click(screen.getByRole("button", { name: "Bestätigen" }));
    expect(await screen.findByText(/etwa 2 Min\./)).toBeInTheDocument();
  });
});
