import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markSessionEnded = vi.fn();
vi.mock("../sessionEnd", () => ({ markSessionEnded: () => markSessionEnded() }));

import {
  ApiError,
  apiGet,
  clearTokens,
  getAccessToken,
  logoutEverywhere,
  revokeRefreshToken,
  storeTokens,
} from "../api";
import { readInvitationToken, stashInvitationToken, takeInvitationRedirect } from "../invitations";

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
  it("sends credentials only for the MCP consent API", async () => {
    fetchMock.mockImplementation(async () => ok({}));
    await apiGet("/api/oauth/authorization-request/r1");
    await apiGet("/api/clubs");
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("include");
    expect(fetchMock.mock.calls[1][1]?.credentials).toBeUndefined();
  });

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

  it("shares ONE refresh between concurrent 401s and retries all with the new tokens", async () => {
    storeTokens("old-access", "refresh-1");
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/auth/token")) {
        refreshCalls++;
        await Promise.resolve();
        return ok({ access_token: "new-access", refresh_token: "refresh-2" });
      }
      const auth = (init?.headers as Record<string, string>)["Authorization"];
      return auth === "Bearer new-access" ? ok({ path: url }) : unauthorized("token_expired");
    });

    const results = await Promise.all([apiGet("/api/a"), apiGet("/api/b"), apiGet("/api/c")]);

    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
    expect(sessionStorage.getItem("refresh_token")).toBe("refresh-2");
    expect(markSessionEnded).not.toHaveBeenCalled();
  });

  it("does not refresh again when another request already renewed the tokens", async () => {
    storeTokens("old-access", "refresh-1");
    fetchMock.mockImplementationOnce(async () => {
      // while this request is in flight, a refresh elsewhere replaced the tokens
      storeTokens("newer-access", "refresh-2");
      return unauthorized("token_expired");
    });
    fetchMock.mockResolvedValueOnce(ok({ done: true }));

    await expect(apiGet("/api/clubs")).resolves.toEqual({ done: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(1)).toBe("Bearer newer-access");
  });

  it("starts a new refresh for a later 401 once the first one is finished", async () => {
    storeTokens("a1", "r1");
    fetchMock
      .mockResolvedValueOnce(unauthorized("token_expired"))
      .mockResolvedValueOnce(ok({ access_token: "a2", refresh_token: "r2" }))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(unauthorized("token_expired"))
      .mockResolvedValueOnce(ok({ access_token: "a3", refresh_token: "r3" }))
      .mockResolvedValueOnce(ok({}));

    await apiGet("/api/x");
    await apiGet("/api/y");

    expect(String(fetchMock.mock.calls[4][1]?.body)).toBe(
      "grant_type=refresh_token&refresh_token=r2",
    );
    expect(sessionStorage.getItem("refresh_token")).toBe("r3");
  });

  it("keeps the session when the refresh is answered with 429 (no verdict on the token)", async () => {
    storeTokens("access", "refresh");
    fetchMock
      .mockResolvedValueOnce(unauthorized("token_expired"))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }));

    await expect(apiGet("/api/clubs")).rejects.toMatchObject({ status: 401 });

    expect(markSessionEnded).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("refresh_token")).toBe("refresh");
  });
});

describe("sign-out calls", () => {
  it("revokeRefreshToken posts the refresh token without an access token and never throws", async () => {
    storeTokens("access", "refresh-9");
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));

    expect(() => revokeRefreshToken()).not.toThrow();

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/auth\/logout$/);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      refresh_token: "refresh-9",
    });
    expect(authOf(0)).toBeUndefined();
  });

  it("revokeRefreshToken sends nothing without a refresh token", () => {
    revokeRefreshToken();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logoutEverywhere posts to logout-all with the access token and rejects on errors", async () => {
    storeTokens("access", "refresh");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(logoutEverywhere()).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/auth\/logout-all$/);
    expect(authOf(0)).toBe("Bearer access");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 500, detail: "x" }), { status: 500 }),
    );
    await expect(logoutEverywhere()).rejects.toMatchObject({ status: 500 });
  });
});

describe("invitation token and sign-out", () => {
  it("clearTokens also drops a stashed invitation token and its redirect flag", () => {
    stashInvitationToken("tok");
    expect(takeInvitationRedirect()).toBe(true);
    clearTokens();
    expect(readInvitationToken()).toBeNull();
    expect(takeInvitationRedirect()).toBe(true);
  });

  it("ending the session (revoked) forgets the invitation token", async () => {
    storeTokens("a", "r");
    stashInvitationToken("tok");
    fetchMock.mockResolvedValueOnce(unauthorized("invalid_token"));
    fetchMock.mockResolvedValueOnce(unauthorized("invalid_refresh_token"));
    await apiGet("/api/x").catch(() => undefined);
    expect(readInvitationToken()).toBeNull();
  });
});
