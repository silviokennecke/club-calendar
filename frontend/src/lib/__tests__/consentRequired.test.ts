import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, CONSENT_REQUIRED_EVENT, EMAIL_VERIFICATION_REQUIRED_EVENT } from "../api";

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

describe("403 consent_required", () => {
  it("fires the refresh event and still rejects with the ApiError", async () => {
    const listener = vi.fn();
    window.addEventListener(CONSENT_REQUIRED_EVENT, listener);
    respond(403, { code: "consent_required", detail: "x" });
    await expect(apiGet("/api/clubs")).rejects.toMatchObject({
      status: 403,
      code: "consent_required",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(CONSENT_REQUIRED_EVENT, listener);
  });

  it("ignores other 403 errors", async () => {
    const listener = vi.fn();
    window.addEventListener(CONSENT_REQUIRED_EVENT, listener);
    respond(403, { code: "forbidden" });
    await expect(apiGet("/api/clubs")).rejects.toMatchObject({ code: "forbidden" });
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(CONSENT_REQUIRED_EVENT, listener);
  });
});

describe("403 email_verification_required", () => {
  it("fires the refresh event so /me shows the verify page", async () => {
    const listener = vi.fn();
    window.addEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, listener);
    respond(403, { code: "email_verification_required", email: "a@b.de" });
    await expect(apiGet("/api/clubs")).rejects.toMatchObject({
      status: 403,
      code: "email_verification_required",
      email: "a@b.de",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, listener);
  });
});
