const KEY = "sso_code_verifier";

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Binds the SSO login code to this browser tab (PKCE S256): keeps a random verifier in sessionStorage and
 * returns its challenge for the start URL. The callback page needs the verifier to redeem the code, so a
 * code produced in someone else's flow cannot be redeemed here.
 */
export async function createSsoChallenge(): Promise<string> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  sessionStorage.setItem(KEY, verifier);
  return base64url(new Uint8Array(digest));
}

/** Returns the verifier of this tab's flow and removes it (single use). */
export function takeSsoVerifier(): string | null {
  const verifier = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  return verifier;
}
