import { useCallback } from "react";
import { ApiError } from "@/lib/api";
import { opaqueReauth, type ReauthPurpose } from "./client";

/** Returns a function that proves the password for `purpose` and resolves with the one-time ticket. */
export function useReauth(purpose: ReauthPurpose): (password: string) => Promise<string> {
  return useCallback((password: string) => opaqueReauth(purpose, password), [purpose]);
}

export type PasswordProof = { reauthTicket: string } | { password: string };

/**
 * Proof body for a password-protected request: an OPAQUE ticket for accounts with a record, else the
 * plain password. The server answers `opaque_not_registered` (409, legacy account) or
 * `opaque_unavailable` (503, flag off) before any secret is checked, so only then it falls back;
 * every other error (wrong password, rate limit, unsupported browser) is thrown.
 */
export function usePasswordProof(
  purpose: ReauthPurpose,
): (password: string) => Promise<PasswordProof> {
  const reauth = useReauth(purpose);
  return useCallback(
    async (password: string) => {
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
