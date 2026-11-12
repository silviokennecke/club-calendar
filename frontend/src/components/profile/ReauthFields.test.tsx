import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReauthFields } from "./ReauthFields";
import {
  emptyReauth,
  reauthBody,
  reauthFieldError,
  reauthMissing,
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
  hasPassword,
  error,
  onValue,
}: {
  hasPassword: boolean;
  error?: string;
  onValue?: (v: ReauthValue) => void;
}) {
  const [value, setValue] = useState(emptyReauth);
  return (
    <ReauthFields
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
    await userEvent.type(screen.getByLabelText(/stepUp\.reauth\.passwordLabel/), "secret");
    expect(onValue).toHaveBeenLastCalledWith({ password: "secret", code: "" });
    expect(screen.queryByText("stepUp.reauth.codeSend")).toBeNull();
  });

  it("mails the step-up code for accounts without a password", async () => {
    apiPost.mockResolvedValue(undefined);
    render(<Harness hasPassword={false} />);
    await userEvent.click(screen.getByRole("button", { name: "stepUp.reauth.codeSend" }));
    expect(apiPost).toHaveBeenCalledWith("/api/auth/step-up/code", {});
    expect(await screen.findByText("stepUp.reauth.codeSent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "stepUp.reauth.codeResend" })).toBeInTheDocument();
  });

  it("shows a rate-limit or generic error when sending fails", async () => {
    const { ApiError } = await import("@/lib/api");
    apiPost.mockRejectedValueOnce(new ApiError("x", 429, "rate_limited"));
    render(<Harness hasPassword={false} />);
    await userEvent.click(screen.getByRole("button", { name: "stepUp.reauth.codeSend" }));
    expect(await screen.findByText("stepUp.reauth.rateLimited")).toBeInTheDocument();
    apiPost.mockRejectedValueOnce(new Error("boom"));
    await userEvent.click(screen.getByRole("button", { name: "stepUp.reauth.codeSend" }));
    expect(await screen.findByText("stepUp.reauth.codeFailed")).toBeInTheDocument();
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
  });

  it("validates missing input", () => {
    expect(reauthMissing(emptyReauth, true, "step_up", t)).toBe("profile.account.passwordMissing");
    expect(reauthMissing({ password: "", code: "12" }, false, "step_up", t)).toBe(
      "stepUp.reauth.codeMissing",
    );
    expect(reauthMissing({ password: "", code: "123456" }, false, "step_up", t)).toBeUndefined();
  });

  it("maps the API codes to field errors", async () => {
    const { ApiError } = await import("@/lib/api");
    expect(reauthFieldError(new ApiError("", 400, "invalid_credentials"), "step_up", t)).toBe(
      "profile.account.wrongPassword",
    );
    expect(reauthFieldError(new ApiError("", 400, "invalid_confirmation_code"), "step_up", t)).toBe(
      "stepUp.reauth.wrongCode",
    );
    expect(reauthFieldError(new ApiError("", 500, "x"), "step_up", t)).toBeUndefined();
  });
});
