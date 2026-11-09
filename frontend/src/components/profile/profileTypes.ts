export interface PasskeyInfo {
  id: string;
  /** Optional: without a name the frontend shows "Dieses Gerät" (older passkeys may have none). */
  deviceName: string | null;
  createdAt: string;
  /** Last successful sign-in with this passkey (null until it was used). */
  lastUsedAt?: string | null;
}

/** `GET /api/auth/me` (the parts the profile page shows besides the user in the auth context). */
export interface ProfileData {
  id: string;
  name: string;
  email: string;
  /** False for SSO-only accounts (no password set yet). */
  hasPassword: boolean;
  passwordProtocol?: "opaque" | "legacy" | null;
  /** New address waiting for its confirmation link (null when none). */
  pendingEmail: string | null;
  passkeys: PasskeyInfo[];
  oauthAccounts: { provider: string }[];
}
