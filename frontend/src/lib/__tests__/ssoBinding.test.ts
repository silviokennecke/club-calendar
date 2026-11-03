import { beforeEach, describe, expect, it } from "vitest";
import { createSsoChallenge, takeSsoVerifier } from "../ssoBinding";

beforeEach(() => sessionStorage.clear());

describe("ssoBinding", () => {
  it("stores a verifier and returns its S256 challenge (43 base64url chars)", async () => {
    const challenge = await createSsoChallenge();
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const verifier = sessionStorage.getItem("sso_code_verifier");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier!));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });

  it("returns the verifier once and removes it", async () => {
    await createSsoChallenge();
    const v = takeSsoVerifier();
    expect(v).not.toBeNull();
    expect(takeSsoVerifier()).toBeNull();
  });
});
