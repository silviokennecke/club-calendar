import { ApiError, apiPost } from "./api";
import { opaqueFailureKind, opaqueReset } from "./opaque";

export type ResetRequestResult = "sent" | "invalid_email" | "failed";

/**
 * `POST /api/auth/forgot-password`. The API answers 204 whether or not the address has an account; a
 * rate limit (429 from a proxy, or the API's own limit, which also answers 204) shows the same
 * "check your inbox" state, so the answer never tells whether an account exists.
 */
export async function requestPasswordReset(email: string): Promise<ResetRequestResult> {
  try {
    await apiPost<void>("/api/auth/forgot-password", { email });
    return "sent";
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return "sent";
    if (e instanceof ApiError && e.code === "validation_failed") return "invalid_email";
    return "failed";
  }
}

export type ResetResult = "done" | "invalid_token" | "weak_password" | "failed";

/** `POST /api/auth/reset-password`: 204 ends all sessions; the user signs in with the new password. */
export async function resetPassword(token: string, password: string): Promise<ResetResult> {
  try {
    await apiPost<void>("/api/auth/reset-password", { token, password });
    return "done";
  } catch (e) {
    const code = e instanceof ApiError ? e.code : undefined;
    if (code === "invalid_reset_token") return "invalid_token";
    if (code === "validation_failed") return "weak_password";
    return "failed";
  }
}

/**
 * Reset through OPAQUE (the register flow with the reset token); while OPAQUE is off the server answers
 * `opaque_unavailable` before the token is touched and the legacy endpoint is used. A browser that cannot
 * run OPAQUE is `unsupported` (never a downgrade to the legacy endpoint).
 */
export async function resetPasswordSecure(
  token: string,
  password: string,
): Promise<ResetResult | "unsupported"> {
  try {
    await opaqueReset(token, password);
    return "done";
  } catch (e) {
    const kind = opaqueFailureKind(e);
    if (kind === "unsupported") return "unsupported";
    if (kind === "unavailable") return resetPassword(token, password);
    const code = e instanceof ApiError ? e.code : undefined;
    if (code === "invalid_reset_token") return "invalid_token";
    if (code === "validation_failed") return "weak_password";
    return "failed";
  }
}
