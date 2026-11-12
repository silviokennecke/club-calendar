import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelStepUp,
  clearStepUp,
  completeStepUp,
  ensureStepUp,
  getStepUpToken,
  StepUpCancelledError,
} from "../stepUp";
import { clearTokens, resetAuthSyncForTests, storeTokens } from "../api";
import { FakeBroadcastChannel } from "./authTestUtils";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
  FakeBroadcastChannel.install();
  FakeBroadcastChannel.sent = [];
  resetAuthSyncForTests();
  clearStepUp();
});

afterEach(() => {
  clearStepUp();
  vi.useRealTimers();
});

describe("step-up token store", () => {
  it("keeps the token in sessionStorage only", () => {
    completeStepUp("tok", 600);
    expect(getStepUpToken()).toBe("tok");
    expect(sessionStorage.getItem("cc_step_up")).toContain("tok");
    expect(JSON.stringify({ ...localStorage })).not.toContain("tok");
  });

  it("is never broadcast to other tabs", () => {
    storeTokens("a", "r");
    FakeBroadcastChannel.sent = [];
    completeStepUp("tok", 600);
    expect(JSON.stringify(FakeBroadcastChannel.sent)).not.toContain("tok");
  });

  it("expires with a safety margin and is not renewed", () => {
    completeStepUp("tok", 600);
    vi.advanceTimersByTime(594_000);
    expect(getStepUpToken()).toBe("tok");
    vi.advanceTimersByTime(2_000);
    expect(getStepUpToken()).toBeNull();
    expect(sessionStorage.getItem("cc_step_up")).toBeNull();
  });

  it("is cleared by clearTokens (logout, session end)", () => {
    completeStepUp("tok", 600);
    clearTokens();
    expect(getStepUpToken()).toBeNull();
  });

  it("resolves waiting requests once with a single prompt", async () => {
    const a = ensureStepUp();
    const b = ensureStepUp();
    completeStepUp("tok", 600);
    await expect(a).resolves.toBe("tok");
    await expect(b).resolves.toBe("tok");
    await expect(ensureStepUp()).resolves.toBe("tok");
  });

  it("rejects waiting requests on cancel and on clear", async () => {
    const a = ensureStepUp();
    cancelStepUp();
    await expect(a).rejects.toBeInstanceOf(StepUpCancelledError);
    const b = ensureStepUp();
    clearStepUp();
    await expect(b).rejects.toBeInstanceOf(StepUpCancelledError);
  });
});
