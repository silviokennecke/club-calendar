import { describe, expect, it } from "vitest";
import {
  filterDatesExcludingHolidays,
  holidayOn,
  isNthWeekdayOfMonth,
  seriesDates,
  seriesPreview,
  type SeriesRule,
} from "../series";

const rule = (partial: Partial<SeriesRule>): SeriesRule => ({
  rhythm: "weekly",
  weekday: 4,
  nth: 1,
  from: "2026-10-03",
  to: "2026-10-31",
  ...partial,
});

describe("seriesDates", () => {
  it("lists every Thursday in the range", () => {
    expect(seriesDates(rule({}))).toEqual(["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
  });

  it("includes the start day when it matches the weekday", () => {
    expect(seriesDates(rule({ weekday: 6, to: "2026-10-10" }))).toEqual([
      "2026-10-03",
      "2026-10-10",
    ]);
  });

  it("takes every second week for the biweekly rhythm", () => {
    expect(seriesDates(rule({ rhythm: "biweekly" }))).toEqual(["2026-10-08", "2026-10-22"]);
  });

  it("finds the n-th and the last weekday of each month", () => {
    const monthly = rule({ rhythm: "monthly", weekday: 1, from: "2026-09-01", to: "2026-11-30" });
    expect(seriesDates({ ...monthly, nth: 1 })).toEqual(["2026-09-07", "2026-10-05", "2026-11-02"]);
    expect(seriesDates({ ...monthly, nth: 5 })).toEqual(["2026-09-28", "2026-10-26", "2026-11-30"]);
  });

  it("returns nothing for missing or reversed ranges", () => {
    expect(seriesDates(rule({ from: "" }))).toEqual([]);
    expect(seriesDates(rule({ from: "2026-11-01", to: "2026-10-01" }))).toEqual([]);
  });

  it("works across the daylight saving time change", () => {
    expect(seriesDates(rule({ weekday: 0, from: "2026-10-20", to: "2026-11-02" }))).toEqual([
      "2026-10-25",
      "2026-11-01",
    ]);
  });
});

describe("isNthWeekdayOfMonth", () => {
  it("knows the 4th and the last", () => {
    expect(isNthWeekdayOfMonth("2026-10-22", 4)).toBe(true);
    expect(isNthWeekdayOfMonth("2026-10-29", 5)).toBe(true);
    expect(isNthWeekdayOfMonth("2026-10-22", 5)).toBe(false);
  });
});

describe("holidays", () => {
  const holidays = [
    { name: "Tag der Deutschen Einheit", date: "2026-10-03", dateEnd: null },
    { name: "Weihnachten", date: "2026-12-25", dateEnd: "2026-12-26" },
  ];

  it("finds holidays including multi-day ranges", () => {
    expect(holidayOn("2026-12-26", holidays)?.name).toBe("Weihnachten");
    expect(holidayOn("2026-12-27", holidays)).toBeUndefined();
  });

  it("removes dates on holidays", () => {
    expect(
      filterDatesExcludingHolidays(["2026-10-03", "2026-12-25", "2026-12-27"], holidays),
    ).toEqual(["2026-12-27"]);
    expect(filterDatesExcludingHolidays(["2026-10-03"], [])).toEqual(["2026-10-03"]);
  });

  it("previews skipped holidays or keeps them", () => {
    const dates = ["2026-10-03", "2026-10-10"];
    const skip = seriesPreview(dates, holidays, true);
    expect(skip.dates).toEqual(["2026-10-10"]);
    expect(skip.holidayCount).toBe(1);
    expect(skip.rows[0]).toEqual({
      date: "2026-10-03",
      holiday: "Tag der Deutschen Einheit",
      skipped: true,
    });
    expect(seriesPreview(dates, holidays, false).dates).toEqual(dates);
  });
});
