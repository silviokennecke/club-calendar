import { describe, expect, it } from "vitest";
import { projectEnd, releaseVelocity, rubberBand, sheetOffset, shouldDismiss } from "../sheetDrag";

describe("sheetDrag", () => {
  it("rubber band is 0 at 0, monotonic and bounded by the dimension", () => {
    expect(rubberBand(0, 400)).toBe(0);
    expect(rubberBand(100, 400)).toBeGreaterThan(0);
    expect(rubberBand(100, 400)).toBeLessThan(100);
    expect(rubberBand(1e6, 400)).toBeLessThan(400);
    expect(rubberBand(-100, 400)).toBe(-rubberBand(100, 400));
  });

  it("follows 1:1 downwards and rubber-bands upwards", () => {
    expect(sheetOffset(120, 400)).toBe(120);
    expect(sheetOffset(-120, 400)).toBeGreaterThan(-120);
    expect(sheetOffset(-120, 400)).toBeLessThan(0);
  });

  it("computes velocity from the last samples", () => {
    const s = [
      { y: 0, t: 0 },
      { y: 10, t: 100 },
      { y: 30, t: 200 },
    ];
    expect(releaseVelocity(s)).toBeCloseTo(150);
    expect(releaseVelocity([{ y: 0, t: 0 }])).toBe(0);
  });

  it("projects the end with deceleration", () => {
    expect(projectEnd(100, 0)).toBe(100);
    expect(projectEnd(100, 100)).toBeCloseTo(100 + 0.1 * 499, 0);
  });

  it("dismisses on a flick, on a far projection, springs back otherwise", () => {
    expect(shouldDismiss(20, 700, 400)).toBe(true);
    expect(shouldDismiss(250, 0, 400)).toBe(true);
    expect(shouldDismiss(60, 50, 400)).toBe(false);
    expect(shouldDismiss(150, 200, 400)).toBe(true); // 150 + 0.2*499 = 250 > 200
    expect(shouldDismiss(-30, 900, 400)).toBe(false);
    expect(shouldDismiss(0, 0, 400)).toBe(false);
  });
});
