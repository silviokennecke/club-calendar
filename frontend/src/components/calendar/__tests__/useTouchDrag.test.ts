import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/calendar";
import { edgeScrollDelta, exceedsSlop, resolveDropDate } from "../useTouchDrag";

const days = [
  "2026-10-19",
  "2026-10-20",
  "2026-10-21",
  "2026-10-22",
  "2026-10-23",
  "2026-10-24",
  "2026-10-25",
] as IsoDate[];

describe("exceedsSlop", () => {
  it("tolerates small jitter and cancels beyond 8px", () => {
    expect(exceedsSlop(3, 4)).toBe(false);
    expect(exceedsSlop(8, 0)).toBe(false);
    expect(exceedsSlop(6, 6)).toBe(true);
    expect(exceedsSlop(0, -9)).toBe(true);
  });
});

describe("resolveDropDate", () => {
  const rect = { left: 100, width: 700 };
  it("maps x to the column", () => {
    expect(resolveDropDate(100, rect, days)).toBe(days[0]);
    expect(resolveDropDate(250, rect, days)).toBe(days[1]);
    expect(resolveDropDate(800, rect, days)).toBe(days[6]);
  });
  it("returns null outside or for degenerate input", () => {
    expect(resolveDropDate(99, rect, days)).toBeNull();
    expect(resolveDropDate(801, rect, days)).toBeNull();
    expect(resolveDropDate(150, { left: 0, width: 0 }, days)).toBeNull();
    expect(resolveDropDate(150, rect, [])).toBeNull();
  });
});

describe("edgeScrollDelta", () => {
  it("scrolls only near the edges, faster closer to them", () => {
    expect(edgeScrollDelta(400, 800)).toBe(0);
    expect(edgeScrollDelta(10, 800)).toBeLessThan(0);
    expect(edgeScrollDelta(790, 800)).toBeGreaterThan(0);
    expect(Math.abs(edgeScrollDelta(0, 800))).toBeGreaterThan(Math.abs(edgeScrollDelta(50, 800)));
  });
});
