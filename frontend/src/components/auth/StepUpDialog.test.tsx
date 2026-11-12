import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";
import { clearStepUp, ensureStepUp, getStepUpToken, StepUpCancelledError } from "@/lib/stepUp";
import { StepUpDialog } from "./StepUpDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

const startAuthentication = vi.fn();
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: (...a: unknown[]) => startAuthentication(...a),
}));

function me(over: Record<string, unknown> = {}, mfa: Record<string, unknown> = {}) {
  return {
    email: "a@example.org",
    hasPassword: true,
    passkeys: [],
    mfa: { enforced: false, totp: null, backupCodes: null, canEnforce: false, ...mfa },
    ...over,
  };
}

async function open(): Promise<{ result: Promise<string> }> {
  render(<StepUpDialog />);
  let p!: Promise<string>;
  act(() => {
    p = ensureStepUp();
  });
  p.catch(() => undefined);
  await screen.findByRole("dialog");
  return { result: p };
}

const submit = () => userEvent.click(screen.getByRole("button", { name: "stepUp.confirm" }));
const password = () => screen.findByLabelText(/stepUp\.reauth\.passwordLabel/);

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  startAuthentication.mockReset();
  toastSuccess.mockReset();
  clearStepUp();
  Object.defineProperty(window, "PublicKeyCredential", { value: class {}, configurable: true });
});

describe("StepUpDialog", () => {
  it("confirms with the password only when MFA is off", async () => {
    apiGet.mockResolvedValue(me());
    apiPost.mockResolvedValue({ stepUpToken: "tok", expiresIn: 600 });
    const { result } = await open();
    await userEvent.type(await password(), "secret");
    await submit();
    await expect(result).resolves.toBe("tok");
    expect(apiPost).toHaveBeenCalledWith("/api/auth/step-up", { password: "secret" });
    expect(getStepUpToken()).toBe("tok");
  });

  it("requires a password before sending", async () => {
    apiGet.mockResolvedValue(me());
    await open();
    await password();
    await submit();
    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.getByText("profile.account.passwordMissing")).toBeInTheDocument();
  });

  it("adds the authenticator code when MFA is on", async () => {
    apiGet.mockResolvedValue(me({}, { enforced: true, totp: { createdAt: "x" } }));
    apiPost.mockResolvedValue({ stepUpToken: "tok", expiresIn: 600 });
    const { result } = await open();
    await userEvent.type(await password(), "secret");
    const digits = document.querySelectorAll<HTMLInputElement>("input[name^='code-']");
    await userEvent.click(digits[0]);
    await userEvent.keyboard("123456");
    await submit();
    await expect(result).resolves.toBe("tok");
    expect(apiPost).toHaveBeenCalledWith("/api/auth/step-up", {
      password: "secret",
      factor: { method: "totp", code: "123456" },
    });
  });

  it("uses a backup code and announces the remaining ones", async () => {
    apiGet.mockResolvedValue(me({}, { enforced: true, totp: { createdAt: "x" } }));
    apiPost.mockResolvedValue({
      stepUpToken: "tok",
      expiresIn: 600,
      backupCodeUsed: true,
      backupCodesRemaining: 4,
    });
    const { result } = await open();
    await userEvent.type(await password(), "secret");
    await userEvent.click(screen.getByRole("button", { name: "stepUp.factor.backup" }));
    await userEvent.type(screen.getByLabelText("stepUp.factor.backupLabel"), "AAAA-BBBB");
    await submit();
    await expect(result).resolves.toBe("tok");
    expect(apiPost).toHaveBeenCalledWith("/api/auth/step-up", {
      password: "secret",
      factor: { method: "backup_code", code: "AAAA-BBBB" },
    });
    expect(toastSuccess).toHaveBeenCalledWith("stepUp.backupUsed:4");
  });

  it("runs the passkey ceremony as the factor", async () => {
    apiGet.mockResolvedValue(me({ passkeys: [{ id: "p1" }] }, { enforced: true, totp: null }));
    apiPost.mockImplementation(async (path: string) =>
      path === "/api/auth/step-up/passkey/options"
        ? { options: { challenge: "c" }, challengeToken: "ct" }
        : { stepUpToken: "tok", expiresIn: 600 },
    );
    startAuthentication.mockResolvedValue({ id: "cred" });
    const { result } = await open();
    await userEvent.type(await password(), "secret");
    await userEvent.click(screen.getByRole("button", { name: "stepUp.factor.passkey" }));
    await submit();
    await expect(result).resolves.toBe("tok");
    expect(apiPost).toHaveBeenLastCalledWith("/api/auth/step-up", {
      password: "secret",
      factor: { method: "passkey", challengeToken: "ct", response: { id: "cred" } },
    });
  });

  it("sends the mailed code for accounts without a password", async () => {
    apiGet.mockResolvedValue(me({ hasPassword: false }));
    apiPost.mockResolvedValue({ stepUpToken: "tok", expiresIn: 600 });
    const { result } = await open();
    await screen.findByText("stepUp.reauth.codeSend");
    const digits = document.querySelectorAll<HTMLInputElement>("input[name^='code-']");
    await userEvent.click(digits[0]);
    await userEvent.keyboard("654321");
    await submit();
    await expect(result).resolves.toBe("tok");
    expect(apiPost).toHaveBeenCalledWith("/api/auth/step-up", { confirmationCode: "654321" });
  });

  it("shows inline errors per code and keeps the dialog open", async () => {
    apiGet.mockResolvedValue(me({}, { enforced: true, totp: { createdAt: "x" } }));
    apiPost.mockRejectedValueOnce(new ApiError("x", 400, "invalid_credentials"));
    await open();
    await userEvent.type(await password(), "bad");
    const digits = document.querySelectorAll<HTMLInputElement>("input[name^='code-']");
    await userEvent.click(digits[0]);
    await userEvent.keyboard("123456");
    await submit();
    expect(await screen.findByText("profile.account.wrongPassword")).toBeInTheDocument();
    apiPost.mockRejectedValueOnce(new ApiError("x", 422, "invalid_mfa_code"));
    await submit();
    expect(await screen.findByText("stepUp.factor.codeWrong")).toBeInTheDocument();
    apiPost.mockRejectedValueOnce(new ApiError("x", 429, "rate_limited"));
    await submit();
    await waitFor(() => expect(screen.getByText("auth.rateLimited")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("rejects the waiting request on cancel", async () => {
    apiGet.mockResolvedValue(me());
    const { result } = await open();
    await userEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    await expect(result).rejects.toBeInstanceOf(StepUpCancelledError);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
