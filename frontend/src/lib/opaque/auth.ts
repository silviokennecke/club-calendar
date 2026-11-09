import { ApiError } from "@/lib/api";
import { OpaqueClientError } from "./ksf";

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

/** Which message a failed OPAQUE call needs beyond the usual credential errors; null = not one of them. */
export type OpaqueFailureKind = "unsupported" | "unavailable" | "reset_required" | "reload";

export function opaqueFailureKind(e: unknown): OpaqueFailureKind | null {
  if (e instanceof OpaqueClientError) return "unsupported";
  if (e instanceof PasswordResetRequiredError) return "reset_required";
  if (e instanceof ApiError) {
    if (e.code === "opaque_unavailable") return "unavailable";
    if (e.code === "reset_required") return "reset_required";
    // stale view of the account's protocol: the legacy endpoint refuses, a reload picks the right path
    if (e.code === "opaque_required") return "reload";
  }
  return null;
}

/** Text key for a failure kind (profile dialogs, signup, reset). */
export const OPAQUE_FAILURE_TEXT: Record<OpaqueFailureKind, string> = {
  unsupported: "auth.opaqueUnsupported",
  unavailable: "auth.opaqueUnavailable",
  reset_required: "auth.opaqueResetRequired",
  reload: "auth.opaqueReload",
};

/** The account has a password the server no longer accepts; the proof cannot be built. */
export class PasswordResetRequiredError extends Error {
  constructor() {
    super("Password reset required");
    this.name = "PasswordResetRequiredError";
  }
}
