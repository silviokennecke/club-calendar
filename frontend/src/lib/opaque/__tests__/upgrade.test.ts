import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const opaqueUpgrade = vi.fn();
vi.mock("../client", () => ({ opaqueUpgrade: (...a: unknown[]) => opaqueUpgrade(...a) }));

import { startOpaqueUpgrade } from "../upgrade";

beforeEach(() => {
  vi.useFakeTimers();
  opaqueUpgrade.mockReset();
  opaqueUpgrade.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("startOpaqueUpgrade", () => {
  it("runs the upgrade in the background with ticket and password", async () => {
    startOpaqueUpgrade({ ticket: "tk", expiresIn: 300 }, "pw-12345");
    expect(opaqueUpgrade).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(opaqueUpgrade).toHaveBeenCalledWith("tk", "pw-12345");
  });

  it("does nothing without an offer or password", async () => {
    startOpaqueUpgrade(undefined, "pw-12345");
    startOpaqueUpgrade({ ticket: "tk", expiresIn: 300 }, "");
    await vi.runAllTimersAsync();
    expect(opaqueUpgrade).not.toHaveBeenCalled();
  });

  it("swallows a failure", async () => {
    opaqueUpgrade.mockRejectedValue(new Error("boom"));
    startOpaqueUpgrade({ ticket: "tk", expiresIn: 300 }, "pw-12345");
    await expect(vi.runAllTimersAsync()).resolves.not.toThrow();
  });
});
