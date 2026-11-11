import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReauthFields } from "./ReauthFields";
import {
  emptyReauth,
  reauthBody,
  reauthFieldError,
  reauthMissing,
  type ReauthPurpose,
  type ReauthValue,
} from "./reauth";

const apiPost = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const t = ((k: string) => k) as never;

function Harness({
  purpose = "delete",
  hasPassword,
  error,
  onValue,
}: {
  purpose?: ReauthPurpose;
  hasPassword: boolean;
  error?: string;
  onValue?: (v: ReauthValue) => void;
}) {
  const [value, setValue] = useState(emptyReauth);
  return (
    <ReauthFields
      purpose={purpose}
      hasPassword={hasPassword}
      email="a@example.org"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
      error={error}
    />
  );
}

beforeEach(() => apiPost.mockReset());

describe("ReauthFields", () => {
  it("shows a password field for accounts with a password", async () => {
    const onValue = vi.fn();
    render(<Harness hasPassword onValue={onValue} />);
    await userEvent.type(screen.getByLabelText(/profile\.danger\.passwordLabel/), "secret");
    expect(onValue).toHaveBeenLastCalledWith({ password: "secret", code: "" });
    expect(screen.queryByText("profile.danger.codeSend")).toBeNull();
  });

  it("shows the mailed-code mode without a password and sends the code", async () => {
    apiPost.mockResolvedValue(undefined);
    render(<Harness hasPassword={false} />);
    await userEvent.click(screen.getByRole("button", { name: "profile.danger.codeSend" }));
    expect(apiPost).toHaveBeenCalledWith("/api/auth/delete-account/code", {});
    expect(await screen.findByText("profile.danger.codeSent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "profile.danger.codeResend" })).toBeInTheDocument();
  });

  it("uses the endpoint of the purpose", async () => {
    apiPost.mockResolvedValue(undefined);
    const cases: [ReauthPurpose, string][] = [
      ["passkey", "/api/auth/webauthn/register/code"],
      ["mfa", "/api/auth/mfa/code"],
    ];
    for (const [purpose, path] of cases) {
      const { unmount } = render(<Harness purpose={purpose} hasPassword={false} />);
      await userEvent.click(screen.getByRole("button", { name: /codeSend$/ }));
      await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith(path, {}));
      unmount();
    }
  });

  it("shows a rate-limit or generic error when sending fails", async () => {
    const { ApiError } = await import("@/lib/api");
    apiPost.mockRejectedValueOnce(new ApiError("x", 429, "rate_limited"));
    render(<Harness purpose="mfa" hasPassword={false} />);
    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.reauth.codeSend" }));
    expect(await screen.findByText("profile.mfa.reauth.rateLimited")).toBeInTheDocument();
    apiPost.mockRejectedValueOnce(new Error("boom"));
    await userEvent.click(screen.getByRole("button", { name: "profile.mfa.reauth.codeSend" }));
    expect(await screen.findByText("profile.mfa.reauth.codeFailed")).toBeInTheDocument();
  });

  it("displays the field error", () => {
    render(<Harness hasPassword error="nope" />);
    expect(screen.getByText("nope")).toBeInTheDocument();
  });
});

describe("reauth helpers", () => {
  it("builds the body per proof kind", () => {
    const v = { password: "p", code: "123456" };
    expect(reauthBody(v, true)).toEqual({ password: "p" });
    expect(reauthBody(v, false)).toEqual({ confirmationCode: "123456" });
    expect(reauthBody(v, false, "code")).toEqual({ code: "123456" });
  });

  it("validates missing input", () => {
    expect(reauthMissing(emptyReauth, true, "mfa", t)).toBe("profile.account.passwordMissing");
    expect(reauthMissing({ password: "", code: "12" }, false, "mfa", t)).toBe(
      "profile.mfa.reauth.codeMissing",
    );
    expect(reauthMissing({ password: "", code: "123456" }, false, "mfa", t)).toBeUndefined();
  });

  it("maps the API codes to field errors", async () => {
    const { ApiError } = await import("@/lib/api");
    expect(reauthFieldError(new ApiError("", 400, "invalid_credentials"), "mfa", t)).toBe(
      "profile.account.wrongPassword",
    );
    expect(reauthFieldError(new ApiError("", 400, "invalid_confirmation_code"), "mfa", t)).toBe(
      "profile.mfa.reauth.wrongCode",
    );
    expect(reauthFieldError(new ApiError("", 500, "x"), "mfa", t)).toBeUndefined();
  });
});
