import { afterEach, describe, expect, it } from "vitest";
import { mapboxTransformRequest } from "../mapboxProxy";
import { clearTokens, storeTokens } from "@/lib/api";

describe("mapboxTransformRequest", () => {
  afterEach(() => clearTokens());

  it("rewrites Mapbox requests to the proxy and sends the access token", () => {
    storeTokens("access-1", "refresh-1");
    const r = mapboxTransformRequest(
      "https://dummy/api.mapbox.com/styles/v1/mapbox/x?access_token=pk.proxy&a=1",
    );
    expect(r.url).toMatch(/\/api\/mapbox\/api\.mapbox\.com\/styles\/v1\/mapbox\/x\?a=1$/);
    expect(r.url).not.toContain("access_token");
    expect((r as { headers?: Record<string, string> }).headers).toEqual({
      Authorization: "Bearer access-1",
    });
  });

  it("sends no Authorization header without a session", () => {
    const r = mapboxTransformRequest("https://dummy/api.mapbox.com/v4/t/1/2/3.vector.pbf");
    expect(r).not.toHaveProperty("headers");
  });

  it("leaves foreign URLs alone", () => {
    storeTokens("access-1", "refresh-1");
    expect(mapboxTransformRequest("https://example.com/a")).toEqual({
      url: "https://example.com/a",
    });
  });
});
