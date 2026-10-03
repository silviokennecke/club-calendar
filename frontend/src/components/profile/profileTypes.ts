export interface PasskeyInfo {
  id: string;
  deviceName: string;
  createdAt: string;
}

/** `GET /api/auth/me` (the parts the profile page shows besides the user in the auth context). */
export interface ProfileData {
  id: string;
  name: string;
  email: string;
  passkeys: PasskeyInfo[];
  oauthAccounts: { provider: string }[];
}
