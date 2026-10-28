import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import {
  changedEventFields,
  changesDate,
  describeSeriesRule,
  formFromRule,
  sameSeriesRule,
  seriesPreviewRows,
  toSeriesRule,
  type SeriesFormRule,
  type SeriesRule,
} from "../series";
import type { EventPayload } from "../form";

// The dates of a rule are computed by the backend only (POST …/events/series/preview); the former
// client-side vectors (weekly, biweekly, n-th / last weekday, DST, leap day, holidays) are PHPUnit
// cases in backend/tests/Controller/EventSeriesTest.php.

const form = (partial: Partial<SeriesFormRule> = {}): SeriesFormRule => ({
  rhythm: "weekly",
  weekday: 4,
  nth: 1,
  from: "2026-10-03",
  to: "2026-10-31",
  skipHolidays: true,
  ...partial,
});

describe("toSeriesRule", () => {
  it("builds the API rule from the form (design: Von / Bis)", () => {
    expect(toSeriesRule(form())).toEqual({
      frequency: "weekly",
      weekday: 4,
      nth: null,
      startDate: "2026-10-03",
      until: "2026-10-31",
      count: null,
      skipHolidays: true,
    });
    expect(toSeriesRule(form({ rhythm: "monthly", nth: 5 }))?.nth).toBe(5);
  });

  it("returns null for missing or reversed ranges (no request)", () => {
    expect(toSeriesRule(form({ from: "" }))).toBeNull();
    expect(toSeriesRule(form({ from: "2026-11-01", to: "2026-10-01" }))).toBeNull();
  });
});

describe("seriesPreviewRows", () => {
  it("merges created dates and skipped holidays in date order", () => {
    const rows = seriesPreviewRows({
      dates: ["2026-10-10", "2026-10-17"],
      count: 2,
      skippedHolidays: [{ date: "2026-10-03", name: "Tag der Deutschen Einheit" }],
      holidays: [
        { date: "2026-10-03", name: "Tag der Deutschen Einheit" },
        { date: "2026-10-17", name: "Herbstfest" },
      ],
    });
    expect(rows).toEqual([
      { date: "2026-10-03", holiday: "Tag der Deutschen Einheit", skipped: true },
      { date: "2026-10-10", holiday: null, skipped: false },
      { date: "2026-10-17", holiday: "Herbstfest", skipped: false },
    ]);
  });
});

describe("describeSeriesRule", () => {
  const rule: SeriesRule = {
    frequency: "weekly",
    weekday: 4,
    nth: null,
    startDate: "2026-10-08",
    until: "2026-10-29",
    count: null,
    skipHolidays: true,
  };
  const t = i18n.getFixedT("de");

  it("names rhythm, weekday, range and holidays", () => {
    const text = describeSeriesRule(rule, t, "de");
    expect(text).toMatch(/^Wöchentlich am Donnerstag, /);
    expect(text).toMatch(/08\.10\.2026 bis .*29\.10\.2026, ohne Feiertage$/);
  });

  it("describes the monthly rhythm and an end by count", () => {
    const text = describeSeriesRule(
      { ...rule, frequency: "monthly", nth: 5, until: null, count: 6, skipHolidays: false },
      t,
      "de",
    );
    expect(text).toMatch(/^Monatlich am letzten Donnerstag, 6 Termine ab /);
  });
});

describe("changedEventFields", () => {
  const base: EventPayload = {
    name: "Training",
    date: "2026-10-08",
    dateEnd: null,
    isAllDay: false,
    timeBegin: "19:00",
    timeEnd: "21:00",
    isDraft: true,
    locationId: null,
    propertyIds: ["a", "b"],
    featureIds: [],
    targetGroupIds: [],
    note: "",
  };

  it("keeps only what the user changed (lists as sets)", () => {
    expect(changedEventFields(base, { ...base, propertyIds: ["b", "a"] })).toEqual({});
    expect(
      changedEventFields(base, { ...base, name: "Neu", targetGroupIds: ["g"], isDraft: false }),
    ).toEqual({ name: "Neu", targetGroupIds: ["g"], isDraft: false });
  });

  it("takes the times along when the all-day switch changes", () => {
    expect(
      changedEventFields(base, { ...base, isAllDay: true, timeBegin: "00:00", timeEnd: "23:59" }),
    ).toEqual({ isAllDay: true, timeBegin: "00:00", timeEnd: "23:59" });
    // Also when the times look unchanged here (other events of the series may have their own)
    const fullDay = { ...base, timeBegin: "00:00", timeEnd: "23:59" };
    expect(changedEventFields(fullDay, { ...fullDay, isAllDay: true })).toEqual({
      isAllDay: true,
      timeBegin: "00:00",
      timeEnd: "23:59",
    });
  });

  it("knows date changes (they stay with this event)", () => {
    expect(changesDate(changedEventFields(base, { ...base, date: "2026-10-09" }))).toBe(true);
    expect(changesDate(changedEventFields(base, { ...base, name: "X" }))).toBe(false);
  });
});

describe("rule change (Reihe ändern)", () => {
  const stored: SeriesRule = {
    frequency: "monthly",
    weekday: 2,
    nth: 5,
    startDate: "2026-10-01",
    until: "2026-12-31",
    count: null,
    skipHolidays: true,
    durationDays: 0,
  };

  it("fills the form from the stored rule and back", () => {
    const f = formFromRule(stored);
    expect(f).toEqual({
      rhythm: "monthly",
      weekday: 2,
      nth: 5,
      from: "2026-10-01",
      to: "2026-12-31",
      skipHolidays: true,
      holidayCalendarIds: null,
    });
    expect(sameSeriesRule(stored, toSeriesRule(f)!)).toBe(true);
    expect(sameSeriesRule(stored, toSeriesRule({ ...f, to: "2027-01-31" })!)).toBe(false);
    expect(sameSeriesRule(stored, toSeriesRule({ ...f, nth: 1 })!)).toBe(false);
    expect(sameSeriesRule(stored, toSeriesRule({ ...f, skipHolidays: false })!)).toBe(false);
  });

  it("carries the chosen holiday calendars through the rule", () => {
    const f = formFromRule({ ...stored, holidayCalendarIds: ["a", "b"] });
    expect(f.holidayCalendarIds).toEqual(["a", "b"]);
    expect(toSeriesRule(f)!.holidayCalendarIds).toEqual(["a", "b"]);
    expect("holidayCalendarIds" in toSeriesRule({ ...f, holidayCalendarIds: null })!).toBe(false);
    expect("holidayCalendarIds" in toSeriesRule({ ...f, skipHolidays: false })!).toBe(false);
    const stored2 = { ...stored, holidayCalendarIds: ["a", "b"] };
    expect(sameSeriesRule(stored2, toSeriesRule({ ...f, holidayCalendarIds: ["b", "a"] })!)).toBe(
      true,
    );
    expect(sameSeriesRule(stored2, toSeriesRule({ ...f, holidayCalendarIds: ["a"] })!)).toBe(false);
    expect(sameSeriesRule(stored2, toSeriesRule({ ...f, holidayCalendarIds: null })!)).toBe(false);
  });

  it("asks for an end date when the series ended by count", () => {
    const byCount = { ...stored, frequency: "weekly" as const, nth: null, until: null, count: 5 };
    const f = formFromRule(byCount);
    expect(f.to).toBe("");
    expect(f.nth).toBe(1);
    expect(toSeriesRule(f)).toBeNull();
    expect(formFromRule(byCount, "2026-11-05").to).toBe("2026-11-05");
    // An end date instead of the count is a change
    expect(sameSeriesRule(byCount, toSeriesRule({ ...f, to: "2026-11-05" })!)).toBe(false);
  });
});
