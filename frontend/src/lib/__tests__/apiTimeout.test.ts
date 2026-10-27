import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markSessionEnded = vi.fn();
vi.mock("../sessionEnd", () => ({ markSessionEnded: () => markSessionEnded() }));

import { ApiError, apiGet, apiPost, clearTokens, refreshSession, storeTokens } from "../api";

/** A fetch that never answers and rejects like the browser when its signal aborts. */
function hangingFetch(_url: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(hangingFetch));
  vi.stubGlobal("location", { href: "/clubs" });
  markSessionEnded.mockReset();
  clearTokens();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearTokens();
});

describe("request timeout", () => {
  it("rejects a hanging request with request_timeout after 30 s", async () => {
    const result = apiGet("/api/clubs").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await result;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "request_timeout", status: 0 });
  });

  it("gives import and export requests 120 s and does not retry a timed-out POST", async () => {
    const result = apiPost("/api/calendars/c1/events/import", {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await result).toMatchObject({ code: "request_timeout" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("gives the PDF export 120 s too", async () => {
    const { apiFetch } = await import("../api");
    const result = apiFetch("/api/calendars/k1/events.pdf?layout=agenda").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ code: "request_timeout" });
  });

  it("does not report a timeout when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const { apiFetch } = await import("../api");
    const result = apiFetch("/api/clubs", { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    const error = await result;
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as Error).name).toBe("AbortError");
  });

  it("does not end the session when the token refresh times out", async () => {
    storeTokens("access", "refresh");
    const result = refreshSession().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ code: "request_timeout" });
    expect(markSessionEnded).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("refresh_token")).toBe("refresh");
  });
});
