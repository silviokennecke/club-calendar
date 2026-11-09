export type IdentifyAuth = "opaque" | "legacy" | "none" | "reset_required";
export type LoginProtocol = "opaque" | "legacy" | "reset";

/**
 * Which login the UI uses for the `auth` hint of `POST /api/auth/identify`. `none` (no credential)
 * shows the normal password form, which fails like a wrong password; `reset_required` sends to reset.
 */
export function loginProtocol(auth: IdentifyAuth | undefined): LoginProtocol {
  if (auth === "opaque") return "opaque";
  if (auth === "reset_required") return "reset";
  return "legacy";
}

/** Signup uses OPAQUE iff the server says so (flag on); a missing hint means legacy. */
export function signupProtocol(auth: IdentifyAuth | undefined): "opaque" | "legacy" {
  return auth === "opaque" ? "opaque" : "legacy";
}

export const OPAQUE_ERROR_CODES = [
  "opaque_unavailable",
  "invalid_opaque_message",
  "opaque_state_invalid",
  "reauth_required",
  "opaque_already_registered",
  "opaque_not_registered",
] as const;
export type OpaqueErrorCode = (typeof OPAQUE_ERROR_CODES)[number];
