import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markSessionEnded = vi.fn();
vi.mock("../sessionEnd", () => ({ markSessionEnded: () => markSessionEnded() }));

import { ApiError, apiGet, clearTokens, getAccessToken, storeTokens } from "../api";

/** RFC 7807 401 of the backend (JwtProblemListener) */
function unauthorized(code: string): Response {
  return new Response(JSON.stringify({ status: 401, detail: "Unauthorized", code }), {
    status: 401,
    headers: { "Content-Type": "application/problem+json", "WWW-Authenticate": "Bearer" },
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();
/** Authorization header of each request at the time it was sent (apiFetch reuses its headers object) */
let sentAuth: (string | undefined)[] = [];
let location: { href: string };

beforeEach(() => {
  fetchMock.mockReset();
  markSessionEnded.mockReset();
  sentAuth = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    sentAuth.push((init?.headers as Record<string, string> | undefined)?.["Authorization"]);
    return fetchMock(input, init);
  });
  location = { href: "/clubs" };
  vi.stubGlobal("location", location);
  clearTokens();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearTokens();
});

const authOf = (call: number) => sentAuth[call];

describe("apiFetch session handling", () => {
  it("refreshes silently on 401 token_expired and retries with the new token", async () => {
    storeTokens("old-access", "refresh-1");
    fetchMock
      .mockResolvedValueOnce(unauthorized("token_expired"))
      .mockResolvedValueOnce(ok({ access_token: "new-access", refresh_token: "refresh-2" }))
      .mockResolvedValueOnce(ok([{ id: "c1" }]));

    await expect(apiGet("/api/clubs")).resolves.toEqual([{ id: "c1" }]);

    expect(authOf(0)).toBe("Bearer old-access");
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/api\/auth\/token$/);
    expect(String(fetchMock.mock.calls[1][1]?.body)).toBe(
      "grant_type=refresh_token&refresh_token=refresh-1",
    );
    expect(authOf(2)).toBe("Bearer new-access");
    expect(getAccessToken()).toBe("new-access");
    expect(sessionStorage.getItem("refresh_token")).toBe("refresh-2");
    expect(markSessionEnded).not.toHaveBeenCalled();
  });

  it("ends the session (login page) when the refresh is rejected too, e.g. an ended session", async () => {
    storeTokens("revoked-access", "revoked-refresh");
    fetchMock.mockResolvedValueOnce(unauthorized("invalid_token")).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 400, code: "invalid_refresh_token" }), {
        status: 400,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );

    await expect(apiGet("/api/clubs")).rejects.toMatchObject({
      status: 401,
      code: "invalid_token",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(markSessionEnded).toHaveBeenCalledOnce();
    expect(location.href).toBe("/login");
    expect(getAccessToken()).toBeNull();
    expect(sessionStorage.getItem("refresh_token")).toBeNull();
  });

  it("does not refresh or leave the page on a 401 without a token (missing_token)", async () => {
    fetchMock.mockResolvedValueOnce(unauthorized("missing_token"));

    const error = await apiGet("/api/clubs").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "missing_token" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(markSessionEnded).not.toHaveBeenCalled();
    expect(location.href).toBe("/clubs");
  });

  it("keeps the session on a 403 (signed in, but no member)", async () => {
    storeTokens("access", "refresh");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 403, detail: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );

    await expect(apiGet("/api/clubs/x")).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(markSessionEnded).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe("access");
  });
});
