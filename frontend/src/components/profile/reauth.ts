import type { TFunction } from "i18next";
import { apiErrorCode } from "@/lib/api";

export type ReauthPurpose = "passkey" | "delete" | "mfa";

export interface ReauthValue {
  password: string;
  code: string;
}

export const emptyReauth: ReauthValue = { password: "", code: "" };

export const CODE_ENDPOINT: Record<ReauthPurpose, string> = {
  passkey: "/api/auth/webauthn/register/code",
  delete: "/api/auth/delete-account/code",
  mfa: "/api/auth/mfa/code",
};

export const TEXT_PREFIX: Record<ReauthPurpose, string> = {
  passkey: "profile.passkeys.reauth",
  delete: "profile.danger",
  mfa: "profile.mfa.reauth",
};

/**
 * Request body for a re-authenticated call. The MFA routes expect `confirmationCode`; the older
 * passkey-registration and account-deletion routes call the same value `code`.
 */
export function reauthBody(
  value: ReauthValue,
  hasPassword: boolean,
  codeKey: "confirmationCode" | "code" = "confirmationCode",
): { password: string } | { confirmationCode: string } | { code: string } {
  return hasPassword
    ? { password: value.password }
    : ({ [codeKey]: value.code } as { confirmationCode: string } | { code: string });
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
