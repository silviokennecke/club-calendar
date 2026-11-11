export interface PasskeyInfo {
  id: string;
  /** Optional: without a name the frontend shows "Dieses Gerät" (older passkeys may have none). */
  deviceName: string | null;
  createdAt: string;
  /** Last successful sign-in with this passkey (null until it was used). */
  lastUsedAt?: string | null;
}

/** `mfa` block of `GET /api/auth/me`. */
export interface MfaStatus {
  enforced: boolean;
  totp: { createdAt: string } | null;
  backupCodes: { remaining: number; createdAt: string } | null;
  /** Enforcing MFA manually is possible (not enforced yet, at least one passkey). */
  canEnforce: boolean;
}

/** `GET /api/auth/me` (the parts the profile page shows besides the user in the auth context). */
export interface ProfileData {
  id: string;
  name: string;
  email: string;
  /** False for SSO-only accounts (no password set yet). */
  hasPassword: boolean;
  /** New address waiting for its confirmation link (null when none). */
  pendingEmail: string | null;
  passkeys: PasskeyInfo[];
  mfa: MfaStatus;
  oauthAccounts: { provider: string }[];
}
