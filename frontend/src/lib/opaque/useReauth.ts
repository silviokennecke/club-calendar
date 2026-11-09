import { useCallback } from "react";
import { ApiError, apiGet } from "@/lib/api";
import { PasswordResetRequiredError } from "./auth";
import { opaqueReauth, type ReauthPurpose } from "./client";

/** Returns a function that proves the password for `purpose` and resolves with the one-time ticket. */
export function useReauth(purpose: ReauthPurpose): (password: string) => Promise<string> {
  return useCallback((password: string) => opaqueReauth(purpose, password), [purpose]);
}

export type PasswordProof = { reauthTicket: string } | { password: string };

/**
 * Proof body for a password-protected request, chosen by the `passwordProtocol` of `GET /api/auth/me`:
 * `opaque` -> ticket, `legacy` -> plain password (the WASM chunk is never loaded for it). Plaintext goes
 * out for `legacy` only; `reset_required` / no password never produce a proof, and every OPAQUE error
 * is thrown, never downgraded.
 */
export function usePasswordProof(
  purpose: ReauthPurpose,
): (password: string) => Promise<PasswordProof> {
  const reauth = useReauth(purpose);
  return useCallback(
    async (password: string) => {
      const me = await apiGet<{ passwordProtocol?: MeProtocol }>("/api/auth/me");
      if (me.passwordProtocol === "legacy") return { password };
      if (me.passwordProtocol === "opaque") return { reauthTicket: await reauth(password) };
      if (me.passwordProtocol === "reset_required") throw new PasswordResetRequiredError();
      throw new ApiError("No password", 409, "no_password");
    },
    [reauth],
  );
}

type MeProtocol = "opaque" | "legacy" | "reset_required" | null;
