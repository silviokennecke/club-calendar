import { afterEach, describe, expect, it, vi } from "vitest";
import { readCalendarView, storeCalendarView } from "../viewMemory";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("viewMemory", () => {
  it("stores and restores per calendar", () => {
    storeCalendarView("a", { view: "week", date: "2026-10-08" });
    storeCalendarView("b", { view: "month", date: "2026-11-01" });
    expect(readCalendarView("a")).toEqual({ view: "week", date: "2026-10-08" });
    expect(readCalendarView("b")).toEqual({ view: "month", date: "2026-11-01" });
    expect(readCalendarView("c")).toBeNull();
  });

  it("ignores garbage", () => {
    for (const raw of [
      "nope",
      "null",
      "[]",
      '{"view":"year","date":"2026-10-08"}',
      '{"view":"week","date":"2026-13-45"}',
      '{"view":"week"}',
    ]) {
      sessionStorage.setItem("calendarView:x", raw);
      expect(readCalendarView("x")).toBeNull();
    }
  });

  it("survives unavailable storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => storeCalendarView("a", { view: "month", date: "2026-10-08" })).not.toThrow();
    expect(readCalendarView("a")).toBeNull();
  });
});
