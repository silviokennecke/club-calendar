import type { TFunction } from "i18next";
import { apiErrorCode } from "@/lib/api";

export type ReauthPurpose = "step_up";

export interface ReauthValue {
  password: string;
  code: string;
}

export const emptyReauth: ReauthValue = { password: "", code: "" };

export const CODE_ENDPOINT: Record<ReauthPurpose, string> = {
  step_up: "/api/auth/step-up/code",
};

export const TEXT_PREFIX: Record<ReauthPurpose, string> = {
  step_up: "stepUp.reauth",
};

/** The proof part of `POST /api/auth/step-up`: the password, or the mailed code of a passwordless account. */
export function reauthBody(
  value: ReauthValue,
  hasPassword: boolean,
): { password: string } | { confirmationCode: string } {
  return hasPassword ? { password: value.password } : { confirmationCode: value.code };
}

/** Client-side check before the request; returns the field error text or undefined. */
export function reauthMissing(
  value: ReauthValue,
  hasPassword: boolean,
  purpose: ReauthPurpose,
  t: TFunction,
): string | undefined {
  if (hasPassword && !value.password) return t("profile.account.passwordMissing");
  if (!hasPassword && !/^\d{6}$/.test(value.code)) return t(`${TEXT_PREFIX[purpose]}.codeMissing`);
  return undefined;
}

/** Field error text for the API codes of a wrong proof; undefined for any other error. */
export function reauthFieldError(
  error: unknown,
  purpose: ReauthPurpose,
  t: TFunction,
): string | undefined {
  const code = apiErrorCode(error);
  if (code === "invalid_credentials") return t("profile.account.wrongPassword");
  if (code === "invalid_confirmation_code") return t(`${TEXT_PREFIX[purpose]}.wrongCode`);
  return undefined;
}
