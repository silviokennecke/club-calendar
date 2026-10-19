import { describe, expect, it } from "vitest";
import { decideSwipe, lockAxis, project } from "../useSwipeNav";

describe("swipe decisions", () => {
  it("locks the axis only after the hysteresis", () => {
    expect(lockAxis(5, 3)).toBeUndefined();
    expect(lockAxis(12, 3)).toBe("x");
    expect(lockAxis(3, -14)).toBe("y");
  });
  it("projects velocity forward", () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeCloseTo(499, 0);
  });
  it("springs back for short slow drags", () => {
    expect(decideSwipe(60, 0, 400)).toBe(0);
    expect(decideSwipe(-60, -100, 400)).toBe(0);
  });
  it("commits past 35% of the width", () => {
    expect(decideSwipe(-160, 0, 400)).toBe(1);
    expect(decideSwipe(160, 0, 400)).toBe(-1);
  });
  it("commits a fast flick over a short distance, only in drag direction", () => {
    expect(decideSwipe(-40, -800, 400)).toBe(1);
    expect(decideSwipe(40, 800, 400)).toBe(-1);
    expect(decideSwipe(-20, 100, 400)).toBe(0);
  });
  it("ignores zero width", () => {
    expect(decideSwipe(100, 900, 0)).toBe(0);
  });
});
