import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";
import { MfaAddDialog } from "./MfaAddDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const apiPost = vi.fn();
const apiPatch = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
}));

const startRegistration = vi.fn();
vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: (...a: unknown[]) => startRegistration(...a),
}));

vi.mock("@/components/ui/shared/QrCode", () => ({
  QrCode: ({ alt }: { alt: string }) => <div role="img" aria-label={alt} />,
}));

const CODES = ["aaaa-1111", "bbbb-2222"];
const setupRes = {
  setupToken: "tok",
  backupCodes: CODES,
  secret: "SECRETKEY",
  otpauthUri: "otpauth://totp/x",
};

function problem(code: string, status = 422) {
  return new ApiError("x", status, code);
}

function renderDialog(props: Partial<React.ComponentProps<typeof MfaAddDialog>> = {}) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <MfaAddDialog
      open
      onClose={onClose}
      onChanged={onChanged}
      totpSet={false}
      enforced={false}
      passkeyCount={0}
      {...props}
    />,
  );
  return { onChanged, onClose };
}

async function toCodeStep() {
  await userEvent.click(screen.getByRole("button", { name: /profile\.mfa\.add\.choose\.totp$/ }));
  await screen.findByRole("img", { name: "profile.mfa.add.totp.qrAlt" });
  const digits = document.querySelectorAll<HTMLInputElement>("input[name^='code-']");
  await userEvent.click(digits[0]);
  await userEvent.keyboard("123456");
  await userEvent.click(screen.getByRole("button", { name: "profile.mfa.add.next" }));
}

beforeEach(() => {
  Object.defineProperty(window, "PublicKeyCredential", { value: class {}, configurable: true });
  apiPost.mockReset();
  apiPatch.mockReset();
  startRegistration.mockReset();
});

describe("MfaAddDialog", () => {
  it("disables the authenticator app option when already set", () => {
    renderDialog({ totpSet: true });
    expect(screen.getByRole("button", { name: /profile\.mfa\.add\.choose\.totp$/ })).toBeDisabled();
  });

  it("sets up TOTP with one enable request after the acknowledgement", async () => {
    apiPost.mockResolvedValueOnce(setupRes).mockResolvedValueOnce({ mfa: {} });
    const { onChanged } = renderDialog();
    await toCodeStep();
    expect(screen.getByText("aaaa-1111")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.add.next" }));
    expect(screen.getByText("profile.mfa.add.codes.ackMissing")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.add.next" }));
    expect(apiPost).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.add.confirm.submit" }));

    await screen.findByText("profile.mfa.add.done.totp");
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(apiPost).toHaveBeenLastCalledWith("/api/auth/mfa/enable", {
      setupToken: "tok",
      method: "totp",
      secret: "SECRETKEY",
      code: "123456",
      backupCodes: CODES,
      backupCodesAcknowledged: true,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("does nothing visible when the step-up confirmation is cancelled", async () => {
    apiPost
      .mockResolvedValueOnce(setupRes)
      .mockRejectedValueOnce(new ApiError("x", 0, "step_up_cancelled"));
    renderDialog();
    await toCodeStep();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.add.next" }));
    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.add.confirm.submit" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("profile.mfa.add.confirm.title")).toBeInTheDocument();
  });

  it("stays on the choice step without an error when the setup confirmation is cancelled", async () => {
    apiPost.mockRejectedValueOnce(new ApiError("x", 0, "step_up_cancelled"));
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: /profile\.mfa\.add\.choose\.totp$/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("profile.mfa.add.errors.setupFailed")).toBeNull();
    expect(screen.getByRole("button", { name: /profile\.mfa\.add\.choose\.totp$/ })).toBeEnabled();
  });

  it("returns to the code step on an invalid TOTP code", async () => {
    apiPost.mockResolvedValueOnce(setupRes).mockRejectedValueOnce(problem("invalid_totp_code"));
    renderDialog();
    await toCodeStep();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.add.next" }));
    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.add.confirm.submit" }));
    expect(await screen.findByText("profile.mfa.add.totp.codeWrong")).toBeInTheDocument();
  });

  it("skips the backup codes step when none are returned", async () => {
    apiPost.mockResolvedValueOnce({ ...setupRes, backupCodes: null });
    renderDialog({ enforced: true });
    await toCodeStep();
    expect(screen.getByText("profile.mfa.add.confirm.title")).toBeInTheDocument();
  });

  it("registers a passkey, then names it with a prefilled name", async () => {
    apiPost
      .mockResolvedValueOnce({ options: {}, challengeToken: "ct" })
      .mockResolvedValueOnce({ ok: true, id: "new" });
    startRegistration.mockResolvedValue({ id: "cred" });
    apiPatch.mockResolvedValue({ ok: true });
    const { onChanged } = renderDialog();

    await userEvent.click(
      screen.getByRole("button", { name: /profile\.mfa\.add\.choose\.passkey$/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.add.passkey.submit" }));

    const name = await screen.findByLabelText("profile.mfa.add.passkey.nameLabel");
    expect(name).not.toHaveValue("");
    expect(apiPost).toHaveBeenNthCalledWith(1, "/api/auth/webauthn/register/options", {});
    expect(apiPost).toHaveBeenNthCalledWith(2, "/api/auth/webauthn/register/verify", {
      challengeToken: "ct",
      response: { id: "cred" },
    });

    await userEvent.clear(name);
    await userEvent.type(name, "Laptop");
    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.add.passkey.save" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/api/auth/webauthn/new", { deviceName: "Laptop" }),
    );
    await screen.findByText("profile.mfa.add.done.passkey");
    expect(onChanged).toHaveBeenCalled();
  });
});
