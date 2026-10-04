import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../api";
import { MAX_RETRIES, shouldRetry } from "../queryRetry";

describe("shouldRetry", () => {
  it.each([400, 401, 403, 404, 409, 422])("does not retry a %s", (status) => {
    expect(shouldRetry(0, new ApiError("x", status))).toBe(false);
  });

  it.each([500, 502, 503])("retries a %s up to the limit", (status) => {
    const error = new ApiError("x", status);
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(MAX_RETRIES - 1, error)).toBe(true);
    expect(shouldRetry(MAX_RETRIES, error)).toBe(false);
  });

  it("retries network failures (no status) up to the limit", () => {
    expect(shouldRetry(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetry(MAX_RETRIES, new TypeError("Failed to fetch"))).toBe(false);
  });

  it("makes a failing 404 query fail at once (no back-off wait)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } });
    const queryFn = vi.fn().mockRejectedValue(new ApiError("API error 404", 404));
    await expect(client.fetchQuery({ queryKey: ["club", "x"], queryFn })).rejects.toThrow("404");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

describe("api helpers throw ApiError with the status", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["apiGet", () => apiGet("/x")],
    ["apiDelete", () => apiDelete("/x")],
    ["apiPost", () => apiPost("/x", {})],
    ["apiPatch", () => apiPatch("/x", {})],
  ])("%s", async (_name, call) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) }),
    );
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });
});
