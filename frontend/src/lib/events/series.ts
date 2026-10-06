/**
 * Series rules (design: EventSeries): the dates a rule produces and the holidays among them.
 * Pure and UTC-based (ISO dates), so the browser's time zone never shifts a day.
 * Only a preview: the backend has no recurrence rules yet (docs/redesign/BACKEND-GAPS.md).
 */
import {
  addDays,
  dayOfWeek,
  daysInMonth,
  isValidIso,
  parseIso,
  type IsoDate,
} from "@/lib/calendar";

export type SeriesRhythm = "weekly" | "biweekly" | "monthly";
/** Position of the weekday in the month: 1.–4. or 5 = last. */
export type SeriesNth = 1 | 2 | 3 | 4 | 5;

export interface SeriesRule {
  rhythm: SeriesRhythm;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Only for the monthly rhythm. */
  nth: SeriesNth;
  from: string;
  to: string;
}

/** Safety limit for the preview (about ten years of weekly dates). */
const MAX_SERIES_DATES = 520;

/** Dates of a rule between `from` and `to` (inclusive), in order. */
export function seriesDates(rule: SeriesRule): IsoDate[] {
  const { from, to, weekday } = rule;
  if (!isValidIso(from) || !isValidIso(to) || to < from) return [];
  const first = addDays(from, (weekday - dayOfWeek(from) + 7) % 7);
  const dates: IsoDate[] = [];
  if (rule.rhythm === "monthly") {
    for (let d = first; d <= to && dates.length < MAX_SERIES_DATES; d = addDays(d, 7)) {
      if (isNthWeekdayOfMonth(d, rule.nth)) dates.push(d);
    }
    return dates;
  }
  const step = rule.rhythm === "biweekly" ? 14 : 7;
  for (let d = first; d <= to && dates.length < MAX_SERIES_DATES; d = addDays(d, step)) {
    dates.push(d);
  }
  return dates;
}

/** Whether the day is the n-th (or with 5: the last) of its weekday in its month. */
export function isNthWeekdayOfMonth(date: IsoDate, nth: SeriesNth): boolean {
  const { year, month, day } = parseIso(date);
  if (nth === 5) return day + 7 > daysInMonth(year, month);
  return Math.ceil(day / 7) === nth;
}

export interface HolidayRange {
  name: string;
  date: string;
  dateEnd?: string | null;
}

/** The holiday covering the date (ranges inclusive), if any. */
export function holidayOn<T extends HolidayRange>(date: IsoDate, holidays: T[]): T | undefined {
  return holidays.find((h) => {
    const start = h.date.slice(0, 10);
    const end = (h.dateEnd ?? h.date).slice(0, 10);
    return date >= start && date <= end;
  });
}

/** Removes dates that fall on a holiday (ranges inclusive). */
export function filterDatesExcludingHolidays<T extends HolidayRange>(
  dates: IsoDate[],
  holidays: T[],
): IsoDate[] {
  return dates.filter((d) => !holidayOn(d, holidays));
}

export interface SeriesPreviewRow {
  date: IsoDate;
  holiday: string | null;
  /** True when the date is skipped because of a holiday. */
  skipped: boolean;
}

export interface SeriesPreview {
  rows: SeriesPreviewRow[];
  /** Dates that would be created. */
  dates: IsoDate[];
  holidayCount: number;
}

export function seriesPreview(
  dates: IsoDate[],
  holidays: HolidayRange[],
  skipHolidays: boolean,
): SeriesPreview {
  const rows = dates.map((date) => {
    const h = holidayOn(date, holidays);
    return { date, holiday: h?.name ?? null, skipped: !!h && skipHolidays };
  });
  return {
    rows,
    dates: rows.filter((r) => !r.skipped).map((r) => r.date),
    holidayCount: rows.filter((r) => r.holiday).length,
  };
}
