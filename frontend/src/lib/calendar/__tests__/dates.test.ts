import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  addMonths,
  addMonthsClamped,
  dayOfWeek,
  daysInMonth,
  diffDays,
  isLeapYear,
  isValidIso,
  isWeekend,
  isoWeek,
  monthGrid,
  monthGridRange,
  parseIso,
  sameMonth,
  startOfWeek,
  toIso,
  todayIn,
  weekDays,
  weekdayOrder,
} from "../dates";

describe("toIso / parseIso", () => {
  it("round-trips and rolls over overflowing values", () => {
    expect(toIso(2026, 9, 8)).toBe("2026-10-08");
    expect(toIso(2026, 11, 32)).toBe("2027-01-01");
    expect(toIso(2026, 0, 0)).toBe("2025-12-31");
    expect(parseIso("2026-10-08")).toEqual({ year: 2026, month: 9, day: 8 });
    expect(parseIso("2026-10-08T19:00:00+02:00")).toEqual({ year: 2026, month: 9, day: 8 });
  });

  it("validates real dates only", () => {
    expect(isValidIso("2028-02-29")).toBe(true);
    expect(isValidIso("2026-02-29")).toBe(false);
    expect(isValidIso("2026-13-01")).toBe(false);
    expect(isValidIso("08.10.2026")).toBe(false);
    expect(isValidIso("")).toBe(false);
    expect(isValidIso(null)).toBe(false);
  });

  it("throws on garbage", () => {
    expect(() => parseIso("nope")).toThrow();
  });
});

describe("day arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("is not affected by daylight saving time changes", () => {
    // Europe: DST starts 2026-03-29, ends 2026-10-25. US: 2026-03-08 / 2026-11-01.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2);
    expect(diffDays("2026-10-24", "2026-10-27")).toBe(3);
    expect(diffDays("2026-01-01", "2027-01-01")).toBe(365);
    expect(diffDays("2028-01-01", "2029-01-01")).toBe(366);
    expect(diffDays("2026-10-10", "2026-10-08")).toBe(-2);
  });

  it("knows weekdays and weekends", () => {
    expect(dayOfWeek("2026-10-08")).toBe(4); // Thursday
    expect(dayOfWeek("2026-10-04")).toBe(0); // Sunday
    expect(isWeekend("2026-10-10")).toBe(true);
    expect(isWeekend("2026-10-11")).toBe(true);
    expect(isWeekend("2026-10-12")).toBe(false);
  });
});

describe("leap years and month lengths", () => {
  it("applies the gregorian rules", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it("returns the days of a month", () => {
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2026, 3)).toBe(30);
    expect(daysInMonth(2026, 11)).toBe(31);
  });
});

describe("month navigation", () => {
  it("wraps months into the next/previous year", () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths({ year: 2026, month: 9 }, -22)).toEqual({ year: 2024, month: 11 });
    expect(addMonths({ year: 2026, month: 9 }, 15)).toEqual({ year: 2028, month: 0 });
  });

  it("clamps the day when the target month is shorter", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-10-31", 1)).toBe("2026-11-30");
    expect(addMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonthsClamped("2028-02-29", 12)).toBe("2029-02-28");
  });

  it("checks month membership", () => {
    expect(sameMonth("2026-10-01", { year: 2026, month: 9 })).toBe(true);
    expect(sameMonth("2026-09-30", { year: 2026, month: 9 })).toBe(false);
  });
});

describe("weeks", () => {
  it("starts weeks on Monday by default", () => {
    expect(startOfWeek("2026-10-08")).toBe("2026-10-05");
    expect(startOfWeek("2026-10-05")).toBe("2026-10-05");
    expect(startOfWeek("2026-10-11")).toBe("2026-10-05"); // Sunday belongs to the week before
    expect(startOfWeek("2026-10-11", 0)).toBe("2026-10-11");
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
  });

  it("lists the seven days of a week", () => {
    expect(weekDays("2026-10-08")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("computes ISO week numbers, also around new year", () => {
    expect(isoWeek("2026-10-05")).toEqual({ year: 2026, week: 41 });
    expect(isoWeek("2026-01-01")).toEqual({ year: 2026, week: 1 });
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(isoWeek("2027-01-04")).toEqual({ year: 2027, week: 1 });
    expect(isoWeek("2024-12-30")).toEqual({ year: 2025, week: 1 });
    // Sunday ends the ISO week; 2021-01-03 still belongs to 2020-W53.
    expect(isoWeek("2021-01-03")).toEqual({ year: 2020, week: 53 });
    expect(isoWeek("2021-01-04")).toEqual({ year: 2021, week: 1 });
    expect(isoWeek("2026-12-28")).toEqual({ year: 2026, week: 53 });
  });
});

describe("monthGrid", () => {
  it("builds full Monday weeks for October 2026 (5 rows)", () => {
    const grid = monthGrid({ year: 2026, month: 9 });
    expect(grid).toHaveLength(5);
    expect(grid[0][0]).toBe("2026-09-28");
    expect(grid[0][3]).toBe("2026-10-01");
    expect(grid[4][6]).toBe("2026-11-01");
    expect(grid.every((w) => w.length === 7)).toBe(true);
  });

  it("handles a February that fits exactly into 4 rows", () => {
    // February 2027 starts on a Monday and has 28 days.
    const grid = monthGrid({ year: 2027, month: 1 });
    expect(grid).toHaveLength(4);
    expect(grid[0][0]).toBe("2027-02-01");
    expect(grid[3][6]).toBe("2027-02-28");
  });

  it("includes the leap day", () => {
    const grid = monthGrid({ year: 2028, month: 1 });
    expect(grid.flat()).toContain("2028-02-29");
    expect(monthGridRange({ year: 2028, month: 1 })).toEqual(["2028-01-31", "2028-03-05"]);
  });

  it("needs 6 rows when a long month starts late in the week", () => {
    // August 2026 starts on a Saturday.
    expect(monthGrid({ year: 2026, month: 7 })).toHaveLength(6);
  });

  it("supports Sunday as first day", () => {
    const grid = monthGrid({ year: 2026, month: 9 }, 0);
    expect(grid[0][0]).toBe("2026-09-27");
    expect(grid[0][4]).toBe("2026-10-01");
  });
});

describe("todayIn", () => {
  afterEach(() => vi.useRealTimers());

  it("uses the calendar's time zone", () => {
    // 22:30 UTC on 2 October = already 3 October in Berlin, still 2 October in New York.
    const now = new Date("2026-10-02T22:30:00Z");
    expect(todayIn("Europe/Berlin", now)).toBe("2026-10-03");
    expect(todayIn("America/New_York", now)).toBe("2026-10-02");
    expect(todayIn("Pacific/Kiritimati", new Date("2026-12-31T11:00:00Z"))).toBe("2027-01-01");
  });

  it("switches the day at local midnight on daylight saving days", () => {
    // 29 March 2026 00:30 CET (UTC+1) and 25 October 2026 00:30 CEST (UTC+2).
    expect(todayIn("Europe/Berlin", new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-29");
    expect(todayIn("Europe/Berlin", new Date("2026-03-28T22:59:00Z"))).toBe("2026-03-28");
    expect(todayIn("Europe/Berlin", new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(todayIn("Europe/Berlin", new Date("2026-10-24T21:59:00Z"))).toBe("2026-10-24");
  });

  it("falls back to the browser zone for unknown or empty zones", () => {
    const now = new Date(2026, 9, 2, 12, 0, 0);
    expect(todayIn(undefined, now)).toBe("2026-10-02");
    expect(todayIn("Not/AZone", now)).toBe("2026-10-02");
  });
});
