import { describe, expect, it } from "vitest";
import {
  formatDayMonth,
  formatMonthTitle,
  formatNumericDate,
  formatShortMonth,
  formatWeekColumn,
  formatWeekRange,
  formatWeekdayDayMonth,
  weekdayNames,
} from "../format";
import { gridKeyTarget, parseAnchor, parseView, stepAnchor, visibleRange } from "../view";

describe("format (Intl, current language)", () => {
  it("formats month titles in German and English", () => {
    expect(formatMonthTitle({ year: 2026, month: 9 }, "de")).toBe("Oktober 2026");
    expect(formatMonthTitle({ year: 2026, month: 9 }, "en")).toBe("October 2026");
    expect(formatMonthTitle({ year: 2027, month: 2 }, "de")).toBe("März 2027");
  });

  it("lists weekday names from Monday or Sunday", () => {
    expect(weekdayNames("de")).toEqual(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
    expect(weekdayNames("en", 0)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(weekdayNames("de", 1, "long")[0]).toBe("Montag");
  });

  it("formats day labels", () => {
    expect(formatDayMonth("2026-10-08", "de")).toBe("8. Oktober");
    expect(formatDayMonth("2026-10-08", "en")).toBe("October 8");
    expect(formatWeekdayDayMonth("2026-10-08", "de")).toBe("Donnerstag, 8. Oktober");
    expect(formatNumericDate("2026-10-16", "de")).toBe("16.10.2026");
    expect(formatShortMonth("2026-10-08", "de")).toBe("Okt");
    expect(formatWeekColumn("2026-10-05", "de")).toBe("Mo 05.10.");
  });

  it("formats week ranges", () => {
    expect(formatWeekRange("2026-10-05", "de")).toMatch(/05\.\s?[–-]\s?11\.10\.2026/);
    expect(formatWeekRange("2026-09-28", "de")).toMatch(/28\.09\.\s?[–-]\s?04\.10\.2026/);
  });
});

describe("view helpers", () => {
  it("parses view and anchor from the URL", () => {
    expect(parseView("week")).toBe("week");
    expect(parseView("list")).toBe("month");
    expect(parseView(null)).toBe("month");
    expect(parseAnchor("2026-02-30", "2026-10-02")).toBe("2026-10-02");
    expect(parseAnchor("2026-11-15", "2026-10-02")).toBe("2026-11-15");
    expect(parseAnchor(null, "2026-10-02")).toBe("2026-10-02");
  });

  it("computes visible ranges", () => {
    expect(visibleRange("month", "2026-10-15")).toEqual(["2026-09-28", "2026-11-01"]);
    expect(visibleRange("week", "2026-10-08")).toEqual(["2026-10-05", "2026-10-11"]);
  });

  it("steps months (clamped) and weeks", () => {
    expect(stepAnchor("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(stepAnchor("month", "2026-12-10", 1)).toBe("2027-01-10");
    expect(stepAnchor("month", "2026-01-10", -1)).toBe("2025-12-10");
    expect(stepAnchor("week", "2026-12-30", 1)).toBe("2027-01-06");
  });

  it("maps grid keys to target dates", () => {
    expect(gridKeyTarget("2026-10-08", "ArrowRight")).toBe("2026-10-09");
    expect(gridKeyTarget("2026-10-01", "ArrowLeft")).toBe("2026-09-30");
    expect(gridKeyTarget("2026-10-29", "ArrowDown")).toBe("2026-11-05");
    expect(gridKeyTarget("2026-10-08", "ArrowUp")).toBe("2026-10-01");
    expect(gridKeyTarget("2026-10-08", "Home")).toBe("2026-10-05");
    expect(gridKeyTarget("2026-10-08", "End")).toBe("2026-10-11");
    expect(gridKeyTarget("2026-10-08", "Home", 0)).toBe("2026-10-04");
    expect(gridKeyTarget("2026-01-31", "PageDown")).toBe("2026-02-28");
    expect(gridKeyTarget("2028-02-29", "PageUp", 1, true)).toBe("2027-02-28");
    expect(gridKeyTarget("2026-10-08", "Enter")).toBeNull();
  });
});
