import { useCallback } from "react";
import { ApiError, apiGet } from "@/lib/api";
import { opaqueReauth, type ReauthPurpose } from "./client";

/** Returns a function that proves the password for `purpose` and resolves with the one-time ticket. */
export function useReauth(purpose: ReauthPurpose): (password: string) => Promise<string> {
  return useCallback((password: string) => opaqueReauth(purpose, password), [purpose]);
}

export type PasswordProof = { reauthTicket: string } | { password: string };

/**
 * Proof body for a password-protected request, chosen by the `passwordProtocol` of `GET /api/auth/me`:
 * `opaque` -> ticket, `legacy` -> plain password (the WASM chunk is never loaded for it). The
 * 409 `opaque_not_registered` / 503 `opaque_unavailable` fallback stays as a safety net; every other
 * error (wrong password, rate limit, unsupported browser) is thrown.
 */
export function usePasswordProof(
  purpose: ReauthPurpose,
): (password: string) => Promise<PasswordProof> {
  const reauth = useReauth(purpose);
  return useCallback(
    async (password: string) => {
      const me = await apiGet<{ passwordProtocol?: "opaque" | "legacy" | null }>("/api/auth/me");
      if (me.passwordProtocol !== "opaque") return { password };
      try {
        return { reauthTicket: await reauth(password) };
      } catch (e) {
        if (
          e instanceof ApiError &&
          (e.code === "opaque_not_registered" || e.code === "opaque_unavailable")
        ) {
          return { password };
        }
        throw e;
      }
    },
    [reauth],
  );
}
