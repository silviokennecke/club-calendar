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

function resetOutcome(e: unknown): ResetResult {
  const code = e instanceof ApiError ? e.code : undefined;
  if (code === "invalid_reset_token") return "invalid_token";
  if (code === "validation_failed") return "weak_password";
  return "failed";
}

/** `POST /api/auth/reset-password`: 204 ends all sessions; the user signs in with the new password. */
export async function resetPassword(token: string, password: string): Promise<ResetResult> {
  try {
    await apiPost<void>("/api/auth/reset-password", { token, password });
    return "done";
  } catch (e) {
    return resetOutcome(e);
  }
}

async function resetViaOpaque(
  token: string,
  password: string,
): Promise<ResetResult | "unsupported" | "unavailable"> {
  try {
    await opaqueReset(token, password);
    return "done";
  } catch (e) {
    const kind = opaqueFailureKind(e);
    if (kind === "unsupported" || kind === "unavailable") return kind;
    return resetOutcome(e);
  }
}

/**
 * Reset through OPAQUE (the register flow with the reset token) unless `opaqueEnabled` (from
 * `GET /api/auth/registration`) is false. With the flag on the legacy endpoint is never called (it answers
 * 409 `opaque_required`); with the flag unknown, a 503 `opaque_unavailable` may still fall back to it, and
 * its `opaque_required` means the flag is on after all (one OPAQUE retry). Flag off + `opaque_required`
 * (flag changed since the page loaded) retries OPAQUE once. A browser that cannot run OPAQUE is
 * `unsupported` (never a downgrade).
 */
export async function resetPasswordSecure(
  token: string,
  password: string,
  opaqueEnabled?: boolean,
): Promise<ResetResult | "unsupported" | "unavailable"> {
  const legacy = async () => {
    try {
      await apiPost<void>("/api/auth/reset-password", { token, password });
      return "done" as const;
    } catch (e) {
      if (e instanceof ApiError && e.code === "opaque_required") return "opaque_required" as const;
      return resetOutcome(e);
    }
  };
  if (opaqueEnabled === false) {
    const r = await legacy();
    return r === "opaque_required" ? resetViaOpaque(token, password) : r;
  }
  const r = await resetViaOpaque(token, password);
  if (r !== "unavailable" || opaqueEnabled === true) return r;
  const l = await legacy();
  if (l !== "opaque_required") return l;
  return resetViaOpaque(token, password);
}
