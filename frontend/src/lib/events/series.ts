/**
 * Event series (design: EventSeries). The backend computes the dates of a rule (`POST …/events/series/
 * preview`, the only source of truth); this module only shapes requests and answers and describes a
 * stored rule for the edit dialog.
 */
import type { TFunction } from "i18next";
import { formatWeekdayDate } from "./format";
import { isValidIso, weekdayNames, type IsoDate } from "@/lib/calendar";
import type { EventPayload } from "./form";

export type SeriesFrequency = "weekly" | "biweekly" | "monthly";
/** Position of the weekday in the month: 1.–4. or 5 = last. */
export type SeriesNth = 1 | 2 | 3 | 4 | 5;

/** Rule as the API takes and returns it (`rule` of the series endpoints). */
export interface SeriesRule {
  frequency: SeriesFrequency;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Only for the monthly rhythm. */
  nth: SeriesNth | null;
  startDate: IsoDate;
  /** End by date (inclusive) … */
  until: IsoDate | null;
  /** … or by number of created events. */
  count: number | null;
  skipHolidays: boolean;
  /** Holiday calendars that count; absent/null = all, [] = none. */
  holidayCalendarIds?: string[] | null;
  /** Extra days of each event (0 = one-day events). */
  durationDays?: number;
}

/** Series of an event in the single GET (`series`) and `GET …/event-series/{id}`. */
export interface EventSeriesInfo {
  id: string;
  templateId: string | null;
  rule: SeriesRule;
  eventCount: number;
}

export interface SeriesHoliday {
  date: IsoDate;
  name: string;
}

/** `POST …/events/series/preview`. */
export interface SeriesPreviewResponse {
  dates: IsoDate[];
  count: number;
  /** Dates left out because of `skipHolidays`. */
  skippedHolidays: SeriesHoliday[];
  /** All dates of the rule on a holiday (skipped or kept). */
  holidays: SeriesHoliday[];
}

/** Most events per series (backend `SeriesRule::MAX_EVENTS`, more → 422 `too_many_events`). */
export const SERIES_MAX_EVENTS = 366;

export interface SeriesFormRule {
  rhythm: SeriesFrequency;
  weekday: number;
  nth: SeriesNth;
  from: string;
  to: string;
  skipHolidays: boolean;
  /** null = all holiday calendars. */
  holidayCalendarIds: string[] | null;
}

/** The API rule for the form (design: "Von" / "Bis"), or null while the range is incomplete or reversed. */
export function toSeriesRule(form: SeriesFormRule): SeriesRule | null {
  if (!isValidIso(form.from) || !isValidIso(form.to) || form.to < form.from) return null;
  return {
    frequency: form.rhythm,
    weekday: form.weekday,
    nth: form.rhythm === "monthly" ? form.nth : null,
    startDate: form.from,
    until: form.to,
    count: null,
    skipHolidays: form.skipHolidays,
    ...(form.skipHolidays && form.holidayCalendarIds
      ? { holidayCalendarIds: form.holidayCalendarIds }
      : {}),
  };
}

/** `POST …/event-series/{id}/preview-update`: what a rule change would do now (only future events change). */
export interface SeriesUpdatePreview {
  toCreate: { date: IsoDate }[];
  toDelete: { id: string; date: IsoDate; name: string; isDraft: boolean }[];
  /** Future events whose date stays in the rule (unchanged, also ones edited on their own). */
  kept: number;
  /** Past events (before today in the calendar's zone): never touched. */
  past: number;
  skippedHolidays: SeriesHoliday[];
}

/** `PATCH …/event-series/{id}`. */
export interface SeriesUpdateResult {
  series: EventSeriesInfo;
  created: number;
  deleted: number;
  kept: number;
}

/**
 * Form values of a stored rule ("Reihe ändern"). The form knows only "Bis": a rule that ended by
 * count gets `fallbackTo` (e.g. the last date of the series) or an empty end the user has to fill.
 */
export function formFromRule(rule: SeriesRule, fallbackTo = ""): SeriesFormRule {
  return {
    rhythm: rule.frequency,
    weekday: rule.weekday,
    nth: rule.nth ?? 1,
    from: rule.startDate,
    to: rule.until ?? fallbackTo,
    skipHolidays: rule.skipHolidays,
    holidayCalendarIds: rule.holidayCalendarIds ?? null,
  };
}

function sameIds(a?: string[] | null, b?: string[] | null): boolean {
  if (!a || !b) return !a && !b;
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Whether the form describes the stored rule (nothing to change). */
export function sameSeriesRule(stored: SeriesRule, next: SeriesRule): boolean {
  return (
    stored.frequency === next.frequency &&
    stored.weekday === next.weekday &&
    (stored.frequency === "monthly" ? stored.nth === next.nth : true) &&
    stored.startDate === next.startDate &&
    stored.until === next.until &&
    stored.count === next.count &&
    stored.skipHolidays === next.skipHolidays &&
    (!stored.skipHolidays || sameIds(stored.holidayCalendarIds, next.holidayCalendarIds))
  );
}

export interface SeriesPreviewRow {
  date: IsoDate;
  holiday: string | null;
  /** True when the date is skipped because of a holiday. */
  skipped: boolean;
}

/** Preview rows in date order: created dates and skipped holidays, each with its holiday name. */
export function seriesPreviewRows(preview: SeriesPreviewResponse): SeriesPreviewRow[] {
  const names = new Map(preview.holidays.map((h) => [h.date, h.name]));
  const rows: SeriesPreviewRow[] = [
    ...preview.dates.map((date) => ({ date, holiday: names.get(date) ?? null, skipped: false })),
    ...preview.skippedHolidays.map((h) => ({ date: h.date, holiday: h.name, skipped: true })),
  ];
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** "Wöchentlich am Donnerstag, 08.10.2026 bis 29.10.2026, ohne Feiertage" (edit dialog). */
export function describeSeriesRule(rule: SeriesRule, t: TFunction, locale: string): string {
  const weekday = weekdayNames(locale, 0, "long")[rule.weekday] ?? "";
  const rhythm =
    rule.frequency === "monthly"
      ? t("events.seriesInfo.rule.monthly", {
          nth: t(`events.seriesInfo.nth.${rule.nth ?? 1}`),
          weekday,
        })
      : t(`events.seriesInfo.rule.${rule.frequency}`, { weekday });
  const start = formatWeekdayDate(rule.startDate, locale);
  const range = rule.until
    ? t("events.seriesInfo.until", { from: start, to: formatWeekdayDate(rule.until, locale) })
    : t("events.seriesInfo.count", { from: start, count: rule.count ?? 0 });
  const parts = [rhythm, range];
  if (rule.skipHolidays) parts.push(t("events.seriesInfo.skipsHolidays"));
  return parts.join(", ");
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x) => b.includes(x));
  return a === b;
}

/**
 * Body of "Alle Termine der Reihe": only the fields the user changed (the backend applies the sent
 * fields to every event of the series; the date fields only to this event). A changed all-day switch
 * takes the times along (all-day events are stored as 00:00 – 23:59).
 */
export function changedEventFields(
  initial: EventPayload,
  current: EventPayload,
): Partial<EventPayload> {
  const changed: Partial<EventPayload> = {};
  for (const key of Object.keys(current) as (keyof EventPayload)[]) {
    if (!sameValue(initial[key], current[key]))
      (changed as Record<string, unknown>)[key] = current[key];
  }
  if ("isAllDay" in changed) {
    changed.timeBegin = current.timeBegin;
    changed.timeEnd = current.timeEnd;
  }
  return changed;
}

/** Whether the changes touch the date of the event (it stays with this event for "all"). */
export function changesDate(changed: Partial<EventPayload>): boolean {
  return "date" in changed || "dateEnd" in changed;
}
