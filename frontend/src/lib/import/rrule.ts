/**
 * Recurrence rules (RFC 5545 RRULE) of the ICS import, expanded in the browser (pure, no React).
 * The import creates SINGLE events from the instances (no series of the app).
 *
 * Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with INTERVAL, COUNT, UNTIL (date or date-time, UTC
 * or floating), BYDAY (weekly: several days; monthly / yearly with BYMONTH: n-th or last weekday
 * like `2MO`, `-1FR`, or every such weekday), BYMONTHDAY (also negative), BYMONTH, WKST (start of
 * the week for WEEKLY with INTERVAL > 1; default Monday). Everything else (BYSETPOS, BYHOUR,
 * BYMINUTE, BYSECOND, BYWEEKNO, BYYEARDAY, SECONDLY / MINUTELY / HOURLY, ordinal BYDAY in a yearly
 * rule without BYMONTH, RSCALE, SKIP) is "unsupported": the caller keeps only the first event.
 * Malformed rules are "invalid" (same handling, never an exception).
 *
 * Dates are whole calendar days (day numbers since 1970-01-01, no Date objects with a zone), so the
 * wall-clock time of the DTSTART stays the same over daylight saving changes. DTSTART is always the
 * first instance and counts for COUNT (like RFC 5545 implementations such as ical.js).
 */
import type { IsoDate } from "@/lib/calendar";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** A BYDAY entry: weekday 0 (Sunday) … 6 and the position (0 = every, 2 = second, -1 = last …). */
export interface ByDay {
  n: number;
  day: number;
}

export interface RRuleBound {
  date: IsoDate;
  /** "HH:MM:SS" or null for a date-only UNTIL. */
  time: string | null;
  utc: boolean;
}

export interface RecurrenceRule {
  freq: Frequency;
  interval: number;
  count: number | null;
  until: RRuleBound | null;
  byDay: ByDay[] | null;
  byMonthDay: number[] | null;
  byMonth: number[] | null;
  /** Start of the week, 0 = Sunday … 6 (default 1 = Monday). */
  wkst: number;
}

export type RRuleParse =
  { ok: true; rule: RecurrenceRule } | { ok: false; reason: "unsupported" | "invalid" };

const DAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const UNSUPPORTED_PARTS = new Set([
  "BYSETPOS",
  "BYHOUR",
  "BYMINUTE",
  "BYSECOND",
  "BYWEEKNO",
  "BYYEARDAY",
  "RSCALE",
  "SKIP",
]);

function intList(value: string, min: number, max: number, allowNegative: boolean): number[] | null {
  const out: number[] = [];
  for (const raw of value.split(",")) {
    if (!/^[+-]?\d{1,3}$/.test(raw)) return null;
    const n = Number(raw);
    const abs = Math.abs(n);
    if (abs < min || abs > max || (n < 0 && !allowNegative)) return null;
    out.push(n);
  }
  return out.length > 0 ? out : null;
}

/** Parses the value of an RRULE property ("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10"). */
export function parseRRule(value: string): RRuleParse {
  const invalid = { ok: false, reason: "invalid" } as const;
  const unsupported = { ok: false, reason: "unsupported" } as const;
  const parts = new Map<string, string>();
  for (const part of value.trim().split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 1) return invalid;
    const key = part.slice(0, eq).toUpperCase();
    if (parts.has(key)) return invalid;
    parts.set(key, part.slice(eq + 1).toUpperCase());
  }
  const freqRaw = parts.get("FREQ");
  if (!freqRaw) return invalid;
  if (["SECONDLY", "MINUTELY", "HOURLY"].includes(freqRaw)) return unsupported;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freqRaw)) return invalid;
  const freq = freqRaw as Frequency;

  let unknown = false;
  for (const key of parts.keys()) {
    if (UNSUPPORTED_PARTS.has(key)) return unsupported;
    if (
      !["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"].includes(
        key,
      )
    )
      unknown = true;
  }
  if (unknown) return invalid;

  let interval = 1;
  if (parts.has("INTERVAL")) {
    if (!/^\d{1,4}$/.test(parts.get("INTERVAL")!)) return invalid;
    interval = Number(parts.get("INTERVAL"));
    if (interval < 1) return invalid;
  }

  let count: number | null = null;
  if (parts.has("COUNT")) {
    if (!/^\d{1,6}$/.test(parts.get("COUNT")!)) return invalid;
    count = Number(parts.get("COUNT"));
    if (count < 1) return invalid;
  }

  let until: RRuleBound | null = null;
  if (parts.has("UNTIL")) {
    if (count !== null) return invalid;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(parts.get("UNTIL")!);
    if (!m) return invalid;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (fromDay(toDay(date)) !== date) return invalid;
    until = {
      date,
      time: m[4] === undefined ? null : `${m[4]}:${m[5]}:${m[6]}`,
      utc: !!m[7],
    };
  }

  let byDay: ByDay[] | null = null;
  if (parts.has("BYDAY")) {
    byDay = [];
    for (const raw of parts.get("BYDAY")!.split(",")) {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(raw);
      if (!m) return invalid;
      const n = m[1] === undefined ? 0 : Number(m[1]);
      if (m[1] !== undefined && (n === 0 || Math.abs(n) > 53)) return invalid;
      byDay.push({ n, day: DAYS[m[2]] });
    }
  }
  const byMonthDay = parts.has("BYMONTHDAY")
    ? intList(parts.get("BYMONTHDAY")!, 1, 31, true)
    : null;
  if (parts.has("BYMONTHDAY") && !byMonthDay) return invalid;
  const byMonth = parts.has("BYMONTH") ? intList(parts.get("BYMONTH")!, 1, 12, false) : null;
  if (parts.has("BYMONTH") && !byMonth) return invalid;

  let wkst = 1;
  if (parts.has("WKST")) {
    const d = DAYS[parts.get("WKST")!];
    if (d === undefined) return invalid;
    wkst = d;
  }

  const ordinals = byDay?.some((d) => d.n !== 0) ?? false;
  // RFC 5545: ordinal BYDAY only in MONTHLY / YEARLY; BYMONTHDAY not in WEEKLY.
  if (ordinals && (freq === "DAILY" || freq === "WEEKLY")) return invalid;
  if (byMonthDay && freq === "WEEKLY") return invalid;
  if (byDay?.some((d) => Math.abs(d.n) > 5) && freq === "MONTHLY") return invalid;
  // n-th weekday of the YEAR (no BYMONTH) is not supported.
  if (ordinals && freq === "YEARLY" && !byMonth) return unsupported;

  return { ok: true, rule: { freq, interval, count, until, byDay, byMonthDay, byMonth, wkst } };
}

// ---- Day numbers ------------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 of an ISO date. */
export function toDay(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromDay(day: number): IsoDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

function dayOf(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function ymd(day: number): [number, number, number] {
  const dt = new Date(day * MS_PER_DAY);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

/** Last day the database stores (event dates up to 9999-12-31). */
const LAST_DAY = toDay("9999-12-31");
/** Safety net against rules that never match (e.g. 31 February): periods tried at most. */
const MAX_PERIODS = 200_000;

/** Days of one month that match BYMONTHDAY / BYDAY (both: intersection), or `fallback`. */
function monthDays(rule: RecurrenceRule, y: number, m: number, fallback: number | null): number[] {
  const dim = daysInMonth(y, m);
  let days: number[] | null = null;
  if (rule.byMonthDay) {
    days = rule.byMonthDay.map((v) => (v < 0 ? dim + 1 + v : v)).filter((v) => v >= 1 && v <= dim);
  }
  if (rule.byDay) {
    const first = weekday(dayOf(y, m, 1));
    const set = new Set<number>();
    for (const { n, day } of rule.byDay) {
      const firstMatch = 1 + ((day - first + 7) % 7);
      const all: number[] = [];
      for (let d = firstMatch; d <= dim; d += 7) all.push(d);
      if (n === 0) all.forEach((d) => set.add(d));
      else {
        const pick = n > 0 ? all[n - 1] : all[all.length + n];
        if (pick !== undefined) set.add(pick);
      }
    }
    days = days ? days.filter((d) => set.has(d)) : [...set];
  }
  if (!days) days = fallback !== null && fallback <= dim ? [fallback] : [];
  return [...new Set(days)].sort((a, b) => a - b).map((d) => dayOf(y, m, d));
}

/** Candidate days of period `k` (ascending). */
function periodDays(rule: RecurrenceRule, startDay: number, k: number): number[] {
  const [sy, sm, sd] = ymd(startDay);
  switch (rule.freq) {
    case "DAILY": {
      const day = startDay + k * rule.interval;
      const [y, m, d] = ymd(day);
      if (rule.byMonth && !rule.byMonth.includes(m)) return [];
      if (rule.byMonthDay) {
        const dim = daysInMonth(y, m);
        if (!rule.byMonthDay.some((v) => (v < 0 ? dim + 1 + v : v) === d)) return [];
      }
      if (rule.byDay && !rule.byDay.some((b) => b.day === weekday(day))) return [];
      return [day];
    }
    case "WEEKLY": {
      const weekStart =
        startDay - ((weekday(startDay) - rule.wkst + 7) % 7) + 7 * rule.interval * k;
      const days = rule.byDay ? rule.byDay.map((b) => b.day) : [weekday(startDay)];
      return [...new Set(days)]
        .map((d) => weekStart + ((d - rule.wkst + 7) % 7))
        .sort((a, b) => a - b)
        .filter((day) => !rule.byMonth || rule.byMonth.includes(ymd(day)[1]));
    }
    case "MONTHLY": {
      const index = sy * 12 + (sm - 1) + rule.interval * k;
      const y = Math.floor(index / 12);
      const m = (index % 12) + 1;
      if (rule.byMonth && !rule.byMonth.includes(m)) return [];
      return monthDays(rule, y, m, sd);
    }
    case "YEARLY": {
      const y = sy + rule.interval * k;
      // BYMONTHDAY or a plain BYDAY without BYMONTH apply to every month of the year
      const months =
        rule.byMonth ??
        (rule.byMonthDay || rule.byDay ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [sm]);
      return [...months]
        .sort((a, b) => a - b)
        .flatMap((m) => monthDays(rule, y, m, rule.byMonthDay || rule.byDay ? null : sd));
    }
  }
}

/** First day of period `k` (to stop once the periods pass the last allowed day). */
function periodStart(rule: RecurrenceRule, startDay: number, k: number): number {
  const [sy, sm] = ymd(startDay);
  switch (rule.freq) {
    case "DAILY":
      return startDay + k * rule.interval;
    case "WEEKLY":
      return startDay - ((weekday(startDay) - rule.wkst + 7) % 7) + 7 * rule.interval * k;
    case "MONTHLY": {
      const index = sy * 12 + (sm - 1) + rule.interval * k;
      return dayOf(Math.floor(index / 12), (index % 12) + 1, 1);
    }
    case "YEARLY":
      return dayOf(sy + rule.interval * k, 1, 1);
  }
}

export interface ExpandOptions {
  /** Time of DTSTART ("HH:MM", null for all-day), compared with a date-time UNTIL. */
  time: string | null;
  /**
   * UNTIL as date (+ time) in the same space as the instances (the caller converts a UTC UNTIL into
   * the zone of a zoned DTSTART); null = the rule's own UNTIL as written.
   */
  until?: { date: IsoDate; time: string | null } | null;
  /** Days that are excluded (EXDATE), as instance dates. Excluded days count for COUNT. */
  isExcluded?: (date: IsoDate) => boolean;
  /** Most instances to keep (after EXDATE). */
  max: number;
  /** For rules without COUNT / UNTIL: instances must start before this day. */
  horizon: IsoDate;
}

export interface ExpandResult {
  dates: IsoDate[];
  /** More instances exist than `max` allowed. */
  capped: boolean;
  /** The rule has no end (no COUNT / UNTIL): limited by the horizon or `max`. */
  unbounded: boolean;
}

/** Instance dates of a rule from `start` (DTSTART first), in ascending order. */
export function expandRule(
  rule: RecurrenceRule,
  start: IsoDate,
  options: ExpandOptions,
): ExpandResult {
  const startDay = toDay(start);
  const time = options.time === null ? null : `${options.time.slice(0, 5)}:00`;
  const until = options.until === undefined ? rule.until : options.until;
  const untilDay = until ? toDay(until.date) : null;
  const unbounded = rule.count === null && until === null;
  const lastDay = Math.min(
    LAST_DAY,
    unbounded ? toDay(options.horizon) - 1 : LAST_DAY,
    untilDay ?? LAST_DAY,
  );

  const dates: IsoDate[] = [];
  let generated = 0;
  let capped = false;
  const beforeUntil = (day: number) => {
    if (untilDay === null) return true;
    if (day !== untilDay) return day < untilDay;
    // Minutes only: the caller passes "HH:MM" (converted UNTIL), the rule "HH:MM:SS"; UNTIL is inclusive
    return !until?.time || time === null || time.slice(0, 5) <= until.time.slice(0, 5);
  };
  /** Adds one instance; false = stop. */
  const take = (day: number): boolean => {
    if (day > lastDay || !beforeUntil(day)) return false;
    generated += 1;
    const date = fromDay(day);
    if (!options.isExcluded?.(date)) {
      if (dates.length >= options.max) {
        capped = true;
        return false;
      }
      dates.push(date);
    }
    return rule.count === null || generated < rule.count;
  };

  if (!take(startDay)) return { dates, capped, unbounded };
  for (let k = 0; k < MAX_PERIODS; k += 1) {
    if (periodStart(rule, startDay, k) > lastDay) break;
    for (const day of periodDays(rule, startDay, k)) {
      if (day <= startDay) continue;
      if (!take(day)) return { dates, capped, unbounded };
    }
  }
  return { dates, capped, unbounded };
}

/** The day two years after `date` (29 February → 1 March; at most 9999-12-31, the last storable day). */
export function twoYearsAfter(date: IsoDate): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  // Beyond year 9999 the ISO string gets a "+0" prefix and the horizon would be lost (NaN)
  if (y + 2 > 9999) return "9999-12-31";
  return fromDay(Math.floor(Date.UTC(y + 2, m - 1, d) / MS_PER_DAY));
}
