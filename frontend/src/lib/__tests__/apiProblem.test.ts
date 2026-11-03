import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiError, apiPost, exchangeOneTimeToken } from "../api";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const fetchMock = vi.fn<typeof fetch>();

function problem(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ status, ...body }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ApiError extra problem members", () => {
  it("exposes retryAt of verification_resend_too_early", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(429, { code: "verification_resend_too_early", retryAt: "2026-10-16T10:05:00Z" }),
    );
    const err = await apiPost("/api/auth/resend-verification", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 429,
      code: "verification_resend_too_early",
      retryAt: "2026-10-16T10:05:00Z",
    });
  });

  it("exposes email of email_verification_required and ignores non-string members", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(403, { code: "email_verification_required", email: "a@b.de", retryAt: 5 }),
    );
    const err = (await apiPost("/api/auth/login", {}).catch((e) => e)) as ApiError;
    expect(err.email).toBe("a@b.de");
    expect(err.retryAt).toBeUndefined();
  });
});

describe("quota_exceeded", () => {
  it("raises an ApiError and shows one toast", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(422, { code: "quota_exceeded", resource: "feedsPerCalendar", limit: 50 }),
    );
    const err = (await apiPost("/api/clubs/c/feeds", {}).catch((e) => e)) as ApiError;
    expect(err).toMatchObject({ status: 422, code: "quota_exceeded" });
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe("exchangeOneTimeToken", () => {
  it("posts the one_time_token grant form-encoded and returns the tokens", async () => {
    const tokens = { access_token: "a", refresh_token: "r", user: { id: "u" } };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(tokens), { status: 200 }));
    await expect(exchangeOneTimeToken("tok en", "ver ifier")).resolves.toEqual(tokens);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auth\/token$/);
    expect(init?.body).toBe("grant_type=one_time_token&token=tok+en&code_verifier=ver+ifier");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("throws an ApiError with the code on failure", async () => {
    fetchMock.mockResolvedValueOnce(problem(400, { code: "invalid_grant" }));
    await expect(exchangeOneTimeToken("x", "v")).rejects.toMatchObject({
      status: 400,
      code: "invalid_grant",
    });
  });
});
