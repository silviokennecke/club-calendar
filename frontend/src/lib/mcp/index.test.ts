import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { decisionFailure, stashReturnTo, takeReturnTo } from "./index";

describe("return path across sign-in", () => {
  beforeEach(() => sessionStorage.clear());

  it("restores only the consent URL, once", () => {
    stashReturnTo("/oauth/consent?request=abc-123");
    expect(takeReturnTo()).toBe("/oauth/consent?request=abc-123");
    expect(takeReturnTo()).toBeNull();
  });

  it("ignores other paths", () => {
    stashReturnTo("https://evil.example/");
    stashReturnTo("/profile");
    expect(takeReturnTo()).toBeNull();
  });

  it("drops a stale entry", () => {
    sessionStorage.setItem(
      "cc.returnTo",
      JSON.stringify({ path: "/oauth/consent?request=a", at: Date.now() - 11 * 60_000 }),
    );
    expect(takeReturnTo()).toBeNull();
  });
});

describe("decisionFailure", () => {
  it("maps codes", () => {
    expect(decisionFailure(new ApiError("x", 404, "authorization_request_not_found"))).toBe(
      "expired",
    );
    expect(decisionFailure(new ApiError("x", 422, "quota_exceeded"))).toBe("quota");
    expect(decisionFailure(new Error("net"))).toBe("failed");
  });
});
