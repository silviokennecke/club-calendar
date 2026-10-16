import { describe, expect, it } from "vitest";
import de from "@/locales/de.json";
import { SSO_ERROR_CODES, ssoErrorKey } from "../ssoError";

describe("ssoErrorKey", () => {
  it("has an own text for every code the backend sends", () => {
    const texts = de.auth.login.ssoError as Record<string, string>;
    for (const code of SSO_ERROR_CODES) {
      const key = ssoErrorKey(code).split(".").pop()!;
      expect(texts[key], code).toBeTruthy();
    }
    expect(ssoErrorKey("provider_denied")).toBe("auth.login.ssoError.provider_denied");
    expect(ssoErrorKey("email_verification_required")).toBe(
      "auth.login.ssoError.email_verification_required",
    );
    expect(ssoErrorKey("email_unverified_at_provider")).toBe(
      "auth.login.ssoError.email_unverified_at_provider",
    );
  });

  it("falls back to the general text", () => {
    expect(ssoErrorKey("oauth_failed")).toBe("auth.login.ssoError.generic");
    expect(ssoErrorKey("something_new")).toBe("auth.login.ssoError.generic");
    expect(ssoErrorKey("")).toBe("auth.login.ssoError.generic");
  });
});
