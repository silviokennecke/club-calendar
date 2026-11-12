/**
 * Error codes the SSO callback of the backend sends in `?error=` (OAuthController), each with its own
 * text in the login page's banner (`auth.login.ssoError.<code>`). Unknown codes get the general text.
 */
export const SSO_ERROR_CODES = [
  "invalid_state",
  "provider_denied",
  "provider_error",
  "oauth_failed",
  "email_missing",
  "account_exists",
  "email_unverified_at_provider",
  "registration_restricted",
  "mfa_link_required",
  // set by the SPA itself when the one-time code of the redirect was rejected
  "invalid_login_code",
  // set by the SPA when this tab did not start the flow; invalid_request also by the backend start route
  "invalid_code_verifier",
  "invalid_request",
] as const;

export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];

export function isSsoErrorCode(code: string): code is SsoErrorCode {
  return (SSO_ERROR_CODES as readonly string[]).includes(code);
}

/** i18n key of the banner text for an `?error=` value. */
export function ssoErrorKey(code: string): `auth.login.ssoError.${SsoErrorCode | "generic"}` {
  return `auth.login.ssoError.${isSsoErrorCode(code) && code !== "oauth_failed" ? code : "generic"}`;
}
