import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiPatch, apiPost, type TokenResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { MfaStatus } from "@/components/profile/profileTypes";

/** Proof of the account holder: `{password}` or `{confirmationCode}` (see `reauthBody`). */
export type Proof = Record<string, string>;

type Tokens = Partial<TokenResponse> | undefined;

function useRefreshProfile() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["profile"] });
}

/** Stores the fresh token pair an MFA change returns (the other sessions ended on the server). */
function useAdoptTokens() {
  const { login } = useAuth();
  return (tokens: Tokens) => {
    if (tokens?.access_token && tokens.refresh_token && tokens.user)
      login(tokens.access_token, tokens.refresh_token, tokens.user);
  };
}

export function useRenamePasskey() {
  const refresh = useRefreshProfile();
  return useMutation({
    mutationFn: ({ id, deviceName }: { id: string; deviceName: string }) =>
      apiPatch<unknown>(`/api/auth/webauthn/${id}`, { deviceName }),
    onSuccess: refresh,
  });
}

export function useDeletePasskey() {
  const refresh = useRefreshProfile();
  const adopt = useAdoptTokens();
  return useMutation({
    mutationFn: ({ id, proof }: { id: string; proof: Proof }) =>
      apiDelete<Tokens>(`/api/auth/webauthn/${id}`, proof),
    onSuccess: async (tokens) => {
      adopt(tokens);
      await refresh();
    },
  });
}

export function useRegenerateBackupCodes() {
  const refresh = useRefreshProfile();
  return useMutation({
    mutationFn: (proof: Proof) =>
      apiPost<{ backupCodes: string[]; mfa: MfaStatus }>("/api/auth/mfa/backup-codes", proof),
    onSuccess: refresh,
  });
}

export function useStartPasskeyEnforcement() {
  return useMutation({
    mutationFn: () =>
      apiPost<{ setupToken: string; backupCodes: string[] }>("/api/auth/mfa/setup", {
        method: "passkeys",
      }),
  });
}

export function useEnablePasskeyEnforcement() {
  const refresh = useRefreshProfile();
  return useMutation({
    mutationFn: ({
      setupToken,
      backupCodes,
      proof,
    }: {
      setupToken: string;
      backupCodes: string[];
      proof: Proof;
    }) =>
      apiPost<unknown>("/api/auth/mfa/enable", {
        setupToken,
        method: "passkeys",
        backupCodes,
        backupCodesAcknowledged: true,
        ...proof,
      }),
    onSuccess: refresh,
  });
}

export function useDisableMfa() {
  const refresh = useRefreshProfile();
  const adopt = useAdoptTokens();
  return useMutation({
    mutationFn: (proof: Proof) => apiPost<Tokens>("/api/auth/mfa/disable", proof),
    onSuccess: async (tokens) => {
      adopt(tokens);
      await refresh();
    },
  });
}

/** Ends every other session and MCP connection; the answer is a fresh token pair for this session. */
export function useSignOutOtherSessions() {
  const adopt = useAdoptTokens();
  return useMutation({
    mutationFn: () => apiPost<Tokens>("/api/auth/sessions/sign-out-others", {}),
    onSuccess: (tokens) => adopt(tokens),
  });
}
