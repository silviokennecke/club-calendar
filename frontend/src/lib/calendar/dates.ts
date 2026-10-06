/**
 * Pure calendar date arithmetic on ISO dates ("YYYY-MM-DD").
 *
 * All calculations use UTC midnight timestamps, so daylight saving time changes in the
 * browser's zone never shift a day. Months are 0-based (0 = January) like `Date`.
 * Weekdays are 0 = Sunday … 6 = Saturday; `weekStart` is 1 (Monday, default) or 0 (Sunday).
 */

export type IsoDate = string;
export type WeekStart = 0 | 1;

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export interface YearMonth {
  year: number;
  /** 0-based month. */
  month: number;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/** Builds an ISO date; overflowing days/months roll over like `Date.UTC`. */
export function toIso(year: number, month: number, day: number): IsoDate {
  return fromUtcMs(Date.UTC(year, month, day));
}

function fromUtcMs(ms: number): IsoDate {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Parses the date part of an ISO string (time and zone suffixes are ignored). */
export function parseIso(iso: string): { year: number; month: number; day: number } {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

export function isValidIso(iso: string | null | undefined): iso is IsoDate {
  if (!iso || !ISO_RE.test(iso)) return false;
  const { year, month, day } = parseIso(iso);
  return toIso(year, month, day) === iso.slice(0, 10);
}

export function toUtcMs(iso: IsoDate): number {
  const { year, month, day } = parseIso(iso);
  return Date.UTC(year, month, day);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIso(iso);
  return toIso(year, month, day + days);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function dayOfWeek(iso: IsoDate): number {
  return new Date(toUtcMs(iso)).getUTCDay();
}

export function isWeekend(iso: IsoDate): boolean {
  const d = dayOfWeek(iso);
  return d === 0 || d === 6;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function addMonths({ year, month }: YearMonth, n: number): YearMonth {
  const idx = year * 12 + month + n;
  return { year: Math.floor(idx / 12), month: ((idx % 12) + 12) % 12 };
}

export function yearMonthOf(iso: IsoDate): YearMonth {
  const { year, month } = parseIso(iso);
  return { year, month };
}

export function sameMonth(iso: IsoDate, ym: YearMonth): boolean {
  const { year, month } = parseIso(iso);
  return year === ym.year && month === ym.month;
}

/**
 * Moves a date by whole months and keeps the day of month where possible
 * (31 January + 1 month = 28/29 February).
 */
export function addMonthsClamped(iso: IsoDate, n: number): IsoDate {
  const { day } = parseIso(iso);
  const target = addMonths(yearMonthOf(iso), n);
  return toIso(target.year, target.month, Math.min(day, daysInMonth(target.year, target.month)));
}

export function startOfWeek(iso: IsoDate, weekStart: WeekStart = 1): IsoDate {
  const offset = (dayOfWeek(iso) - weekStart + 7) % 7;
  return addDays(iso, -offset);
}

export function weekDays(iso: IsoDate, weekStart: WeekStart = 1): IsoDate[] {
  const start = startOfWeek(iso, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** ISO 8601 week number (weeks start on Monday, week 1 contains 4 January). */
export function isoWeek(iso: IsoDate): { year: number; week: number } {
  const thursday = addDays(iso, 3 - ((dayOfWeek(iso) + 6) % 7));
  const year = parseIso(thursday).year;
  const week = Math.floor(diffDays(toIso(year, 0, 1), thursday) / 7) + 1;
  return { year, week };
}

/**
 * The weeks shown for a month: full weeks from the week containing the 1st to the week
 * containing the last day (4 to 6 rows). Days of neighbouring months are included.
 */
export function monthGrid(ym: YearMonth, weekStart: WeekStart = 1): IsoDate[][] {
  const first = toIso(ym.year, ym.month, 1);
  const last = toIso(ym.year, ym.month, daysInMonth(ym.year, ym.month));
  const start = startOfWeek(first, weekStart);
  const weeks = Math.ceil((diffDays(start, last) + 1) / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)),
  );
}

/** First and last day (inclusive) visible in a month grid. */
export function monthGridRange(ym: YearMonth, weekStart: WeekStart = 1): [IsoDate, IsoDate] {
  const grid = monthGrid(ym, weekStart);
  return [grid[0][0], grid[grid.length - 1][6]];
}

/** Weekday indexes (0 = Sunday) in display order. */
export function weekdayOrder(weekStart: WeekStart = 1): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

/**
 * Today's date in a time zone (IANA name, e.g. "Europe/Berlin"). Falls back to the browser's
 * zone for an empty or unknown zone.
 */
export function todayIn(timeZone?: string | null, now: Date = new Date()): IsoDate {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      const iso = `${get("year")}-${get("month")}-${get("day")}`;
      if (isValidIso(iso)) return iso;
    } catch {
      /* unknown zone: fall through */
    }
  }
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}
