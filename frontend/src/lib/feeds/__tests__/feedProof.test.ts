import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFeedProof,
  feedJoinFailure,
  feedProofBody,
  readFeedProof,
  stashFeedProof,
  takeFeedJoinRedirect,
} from "../feedProof";

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

describe("feed proof stash", () => {
  it("stores, reads and clears the proof", () => {
    expect(readFeedProof()).toBeNull();
    stashFeedProof({ feedId: "f1", secret: "s" });
    expect(readFeedProof()).toEqual({ feedId: "f1", secret: "s" });
    expect(feedProofBody()).toEqual({ feedProof: { feedId: "f1", secret: "s" } });
    clearFeedProof();
    expect(readFeedProof()).toBeNull();
    expect(feedProofBody()).toEqual({});
  });

  it("omits an empty secret", () => {
    stashFeedProof({ feedId: "f1", secret: "" });
    expect(readFeedProof()).toEqual({ feedId: "f1", secret: undefined });
  });

  it("expires after an hour", () => {
    vi.useFakeTimers();
    stashFeedProof({ feedId: "f1" });
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(readFeedProof()).toBeNull();
  });

  it("ignores garbage", () => {
    sessionStorage.setItem("cc.feedProof", "{nope");
    expect(readFeedProof()).toBeNull();
  });

  it("allows the join redirect once per stash", () => {
    stashFeedProof({ feedId: "f1" });
    expect(takeFeedJoinRedirect()).toBe(true);
    expect(takeFeedJoinRedirect()).toBe(false);
    stashFeedProof({ feedId: "f1" });
    expect(takeFeedJoinRedirect()).toBe(true);
  });
});

describe("feedJoinFailure", () => {
  it("maps the error codes", () => {
    expect(feedJoinFailure({ code: "member_signup_disabled" })).toBe("signupDisabled");
    expect(feedJoinFailure({ code: "feed_not_found" })).toBe("notFound");
    expect(feedJoinFailure({ code: "quota_exceeded" })).toBe("quota");
    expect(feedJoinFailure({ code: "rate_limited" })).toBe("rateLimited");
    expect(feedJoinFailure(new Error("x"))).toBe("failed");
  });
});
