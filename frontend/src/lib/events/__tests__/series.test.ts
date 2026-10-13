import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import {
  changedEventFields,
  changesDate,
  describeSeriesRule,
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
