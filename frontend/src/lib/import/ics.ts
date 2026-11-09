/**
 * ICS parsing for the import (pure, no React). The file is parsed in the browser (encodings, Windows
 * zone names, UTC times); the backend checks the reviewed events (`POST …/events/import/preview`) and
 * imports them in one request (`POST …/events/import`).
 */
import { addDays, isValidIso, type IsoDate } from "@/lib/calendar";
import { windowsZoneToIana } from "./windowsZones";
import { expandRule, fromDay, parseRRule, toDay, twoYearsAfter } from "./rrule";
import { NOTE_MAX } from "@/lib/events/form";
import { IMPORT_MAX } from "./review";

/** Most instances one recurrence (RRULE + RDATE) is expanded to (a year of daily events). */
export const MAX_INSTANCES_PER_RULE = 366;

export interface ParsedIcsEvent {
  /** UID of the file ("" = none); sent as `externalUid` for the duplicate check of later imports. */
  uid: string;
  name: string;
  date: IsoDate;
  /** Empty for single-day events. */
  dateEnd: IsoDate | "";
  isAllDay: boolean;
  /** "HH:MM"; whole-day events use 00:00 – 23:59. */
  timeBegin: string;
  timeEnd: string;
  timezone: string | null;
  /** Free text of the LOCATION property ("" = none). */
  locationText: string;
  /** DESCRIPTION as plain text, newlines kept, cut at NOTE_MAX ("" = none). */
  note: string;
  /**
   * Instance of a recurrence of the file (RRULE / RDATE / RECURRENCE-ID), imported as a single event;
   * `uid` is then `${UID}#${YYYYMMDD}` (date of the instance as imported), one per instance.
   */
  recurring: boolean;
  /** Same key for all instances of one recurrence (the UID), null for other events. */
  recurrenceKey: string | null;
  /** The RRULE is not supported or broken: only this first event is imported. */
  recurrenceUnsupported: boolean;
}

/** What expanding the recurrences of a file did (hints of the review). */
export interface RecurrenceStats {
  /** Recurrences expanded (events with a supported RRULE or RDATE). */
  rules: number;
  /** Events created from them (all instances, overrides included). */
  instances: number;
  /** Events with an unsupported or broken RRULE (only the first event is imported). */
  unsupported: number;
  /** Recurrences cut at MAX_INSTANCES_PER_RULE. */
  capped: number;
  /** Recurrences without an end (no COUNT / UNTIL): limited to two years or MAX_INSTANCES_PER_RULE. */
  unbounded: number;
  /** Instances left out because the file would exceed IMPORT_MAX events. */
  dropped: number;
}

export type SkipReason = "noName" | "noDate" | "invalidDate";

export interface SkippedIcsEvent {
  reason: SkipReason;
  /** SUMMARY if there was one. */
  name: string;
}

export interface IcsParseResult {
  events: ParsedIcsEvent[];
  skipped: SkippedIcsEvent[];
  recurrence: RecurrenceStats;
}

export interface IcsParseOptions {
  /** Zone UTC times ("…Z") are converted to (the calendar's time zone). */
  timeZone?: string | null;
}

/** Joins folded lines (RFC 5545: a line starting with space/tab continues the previous one). */
export function unfoldIcs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

/** Resolves the TEXT escapes of RFC 5545 (\\, \; \, \n). */
export function unescapeIcsText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

interface Prop {
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): { name: string; prop: Prop } | null {
  // Name and parameters end at the first ":" outside of quotes.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 1) return null;
  const [rawName, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: rawName.toUpperCase(), prop: { params, value: line.slice(colon + 1) } };
}

interface When {
  date: IsoDate;
  /** "HH:MM" or null for date-only values. */
  time: string | null;
  utc: boolean;
  tzid: string | null;
}

/** Parses "20261010", "20261010T180000" or "20261010T180000Z". Null if malformed. */
function parseWhen(prop: Prop | undefined): When | "invalid" | null {
  if (!prop || !prop.value.trim()) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(prop.value.trim());
  if (!m) return "invalid";
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!isValidIso(date)) return "invalid";
  const dateOnly = prop.params.VALUE?.toUpperCase() === "DATE" || m[4] === undefined;
  if (dateOnly) return { date, time: null, utc: false, tzid: null };
  if (Number(m[4]) > 23 || Number(m[5]) > 59) return "invalid";
  return {
    date,
    time: `${m[4]}:${m[5]}`,
    utc: !!m[7],
    tzid: validZone(prop.params.TZID),
  };
}

/**
 * The IANA zone name for a TZID: real IANA names are kept, Windows names ("W. Europe Standard Time",
 * written by Outlook) are mapped via a table, everything else is null (the backend builds a
 * DateTimeZone from the event's zone, so an unknown name would break the feed).
 */
function validZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const mapped = windowsZoneToIana(tzid);
  if (mapped) return mapped;
  if (tzid.length > 64 || !/^[A-Za-z_]+(?:[/+-][A-Za-z0-9_]+)*$/.test(tzid)) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tzid });
    return tzid;
  } catch {
    return null;
  }
}

/** Length of an ISO 8601 duration (RFC 5545 DURATION) in whole days and minutes; null if malformed. */
export function parseDuration(value: string): { days: number; minutes: number } | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(
    value.trim(),
  );
  if (!m || value.trim().replace(/^[+-]?P/i, "") === "") return null;
  const sign = m[1] === "-" ? -1 : 1;
  const n = (v: string | undefined) => Number(v ?? 0);
  return {
    days: sign * (n(m[2]) * 7 + n(m[3])),
    minutes: sign * (n(m[4]) * 60 + n(m[5])),
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Cached formatter of a zone (creating one per instance would make large imports slow). */
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(epochMs: number, timeZone: string): { date: IsoDate; time: string } {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** Milliseconds of a date and time read as UTC ("naive", no zone). */
function naiveMs(date: IsoDate, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi);
}

function fromNaiveMs(ms: number): { date: IsoDate; time: string } {
  const iso = new Date(ms).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** Converts a UTC date and time to the wall clock of `timeZone` (unknown zones stay UTC). */
export function utcToZone(
  date: IsoDate,
  time: string,
  timeZone: string,
): { date: IsoDate; time: string } {
  try {
    return wallClock(naiveMs(date, time), timeZone);
  } catch {
    return { date, time };
  }
}

/** Converts a wall-clock date and time of `timeZone` to UTC (unknown zones stay as they are). */
export function zonedToUtc(
  date: IsoDate,
  time: string,
  timeZone: string,
): { date: IsoDate; time: string } {
  try {
    const naive = naiveMs(date, time);
    const offset = (ms: number) => {
      const w = wallClock(ms, timeZone);
      return naiveMs(w.date, w.time) - Math.floor(ms / 60_000) * 60_000;
    };
    let epoch = naive - offset(naive);
    const second = offset(epoch);
    if (naive - second !== epoch) epoch = naive - second;
    return fromNaiveMs(epoch);
  } catch {
    return { date, time };
  }
}

function localize(
  when: When,
  timeZone: string | null | undefined,
): { date: IsoDate; time: string | null } {
  if (when.time && when.utc && timeZone) return utcToZone(when.date, when.time, timeZone);
  return { date: when.date, time: when.time };
}

type Props = Map<string, Prop[]>;

const first = (props: Props, name: string): Prop | undefined => props.get(name)?.[0];

/** All values of a multi-valued property (EXDATE, RDATE: several lines and comma lists). */
function whensOf(props: Props, name: string): When[] {
  const out: When[] = [];
  for (const prop of props.get(name) ?? []) {
    for (const raw of prop.value.split(",")) {
      // RDATE;VALUE=PERIOD: "start/end" or "start/duration" → the start
      const value = raw.split("/")[0].trim();
      const when = parseWhen({ params: prop.params, value });
      if (when && when !== "invalid") out.push(when);
    }
  }
  return out;
}

/** Instances are compared in the representation of DTSTART: all-day, UTC, a zone or floating. */
type Space =
  | { kind: "date" }
  | { kind: "utc" }
  | { kind: "zone"; zone: string }
  | { kind: "floating"; zone: string | null };

function spaceOf(start: When, calendarZone: string | null | undefined): Space {
  if (start.time === null) return { kind: "date" };
  if (start.utc) return { kind: "utc" };
  if (start.tzid) return { kind: "zone", zone: start.tzid };
  return { kind: "floating", zone: calendarZone ?? null };
}

/** A value of EXDATE / RDATE / RECURRENCE-ID / UNTIL in the representation of the instances. */
function inSpace(
  when: { date: IsoDate; time: string | null; utc: boolean; tzid: string | null },
  space: Space,
  calendarZone: string | null | undefined,
): { date: IsoDate; time: string | null } {
  const time = when.time;
  if (time === null) return { date: when.date, time: null };
  // To UTC first (a zoned value), then to the target
  let utc: { date: IsoDate; time: string } | null = null;
  if (when.utc) utc = { date: when.date, time };
  else if (when.tzid && !(space.kind === "zone" && space.zone === when.tzid))
    utc = zonedToUtc(when.date, time, when.tzid);
  const target =
    space.kind === "zone" ? space.zone : space.kind === "utc" ? null : (calendarZone ?? null);
  if (space.kind === "date") {
    const local = utc && calendarZone ? utcToZone(utc.date, utc.time, calendarZone) : null;
    return { date: local?.date ?? when.date, time: null };
  }
  if (!utc) {
    if (space.kind === "utc" && calendarZone) return zonedToUtc(when.date, time, calendarZone);
    return { date: when.date, time };
  }
  return target ? utcToZone(utc.date, utc.time, target) : utc;
}

/** "2026-10-08" → "20261008" (suffix of the per-instance UID). */
function compact(date: IsoDate): string {
  return date.replace(/-/g, "");
}

/** FNV-1a (32 bit) as 8 hex digits: keeps two shortened UIDs with the same beginning apart. */
function shortHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * UID of one instance: `${uid}#YYYYMMDD`. A UID longer than 246 characters is shortened to 237
 * characters + "~" + a hash of the whole UID, so the result fits 255 characters (the column) and two
 * long UIDs with the same beginning stay different (counted in code points: no split surrogate pairs).
 */
export function instanceUid(uid: string, date: IsoDate): string {
  if (!uid) return "";
  const chars = Array.from(uid);
  const base = chars.length <= 246 ? uid : `${chars.slice(0, 237).join("")}~${shortHash(uid)}`;
  return `${base}#${compact(date)}`;
}

/** Parses all VEVENTs; events that cannot be imported are reported in `skipped`. */
export function parseIcs(text: string, options: IcsParseOptions = {}): IcsParseResult {
  const events: ParsedIcsEvent[] = [];
  const skipped: SkippedIcsEvent[] = [];
  const stats: RecurrenceStats = {
    rules: 0,
    instances: 0,
    unsupported: 0,
    capped: 0,
    unbounded: 0,
    dropped: 0,
  };
  const tz = options.timeZone;
  const vevents: Props[] = [];
  let current: Props | null = null;
  /** Depth of nested components (VALARM) inside the current VEVENT. */
  let nested = 0;

  for (const line of unfoldIcs(text)) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = new Map();
      nested = 0;
      continue;
    }
    if (!current) continue;
    // Nested components (VALARM) carry their own properties; ignore them.
    if (upper.startsWith("BEGIN:")) {
      nested += 1;
      continue;
    }
    if (nested > 0) {
      if (upper.startsWith("END:")) nested -= 1;
      continue;
    }
    if (upper === "END:VEVENT") {
      vevents.push(current);
      current = null;
      continue;
    }
    const parsed = parseLine(line);
    if (parsed) {
      const list = current.get(parsed.name);
      if (list) list.push(parsed.prop);
      else current.set(parsed.name, [parsed.prop]);
    }
  }

  // RECURRENCE-ID entries replace one instance of the event with the same UID.
  const overrides = new Map<string, Props[]>();
  for (const props of vevents) {
    const uid = first(props, "UID")?.value.trim() ?? "";
    if (uid && first(props, "RECURRENCE-ID")) {
      overrides.set(uid, [...(overrides.get(uid) ?? []), props]);
    }
  }
  const expandedUids = new Set<string>();
  /** First instance of each recurrence (never dropped by the total limit). */
  const firstInstances = new Set<ParsedIcsEvent>();

  // Masters first (they decide which overrides apply), the overrides of unknown masters after.
  vevents.forEach((props, index) => {
    if (first(props, "RECURRENCE-ID")) return;
    const uid = first(props, "UID")?.value.trim() ?? "";
    const master = buildEvent(props, tz);
    if ("reason" in master) return void skipped.push(master);
    if (!first(props, "RRULE") && !first(props, "RDATE")) return void events.push(master.event);

    const parsedRule = first(props, "RRULE") ? parseRRule(first(props, "RRULE")!.value) : null;
    if (parsedRule && !parsedRule.ok) {
      stats.unsupported += 1;
      return void events.push({ ...master.event, recurrenceUnsupported: true });
    }

    const key = uid || `#${index}`;
    const start = master.start;
    const space = spaceOf(start, tz);
    const sameTime = (t: string | null) => t === null || start.time === null || t === start.time;
    const excluded = whensOf(props, "EXDATE").map((w) => inSpace(w, space, tz));
    const excludedDates = new Set(excluded.filter((e) => sameTime(e.time)).map((e) => e.date));
    const isExcluded = (date: IsoDate, time: string | null = start.time) =>
      excluded.some(
        (e) => e.date === date && (e.time === null || time === null || e.time === time),
      );

    let dates: { date: IsoDate; time: string | null }[] = [{ date: start.date, time: start.time }];
    let capped = false;
    let unbounded = false;
    if (parsedRule?.ok) {
      const rule = parsedRule.rule;
      const until = rule.until
        ? inSpace(
            { ...rule.until, time: rule.until.time?.slice(0, 5) ?? null, tzid: null },
            space,
            tz,
          )
        : null;
      const expanded = expandRule(rule, start.date, {
        time: start.time,
        until,
        isExcluded: (date) => excludedDates.has(date),
        max: MAX_INSTANCES_PER_RULE,
        horizon: twoYearsAfter(start.date),
      });
      dates = expanded.dates.map((date) => ({ date, time: start.time }));
      capped = expanded.capped;
      unbounded = expanded.unbounded;
    } else if (isExcluded(start.date)) {
      dates = [];
    }
    // RDATE adds instances (also beyond COUNT), EXDATE removes them
    const seen = new Set(dates.map((d) => `${d.date} ${d.time ?? ""}`));
    for (const extra of whensOf(props, "RDATE").map((w) => inSpace(w, space, tz))) {
      const time = start.time === null ? null : (extra.time ?? start.time);
      const id = `${extra.date} ${time ?? ""}`;
      if (seen.has(id) || isExcluded(extra.date, time) || extra.date < start.date) continue;
      if (dates.length >= MAX_INSTANCES_PER_RULE) {
        capped = true;
        break;
      }
      seen.add(id);
      dates.push({ date: extra.date, time });
    }
    dates.sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));

    // Instances replaced by a RECURRENCE-ID entry of the file
    const replaced = uid ? (overrides.get(uid) ?? []) : [];
    const replacedAt = replaced.map((o) => {
      const rid = parseWhen(first(o, "RECURRENCE-ID"));
      return rid && rid !== "invalid" ? inSpace(rid, space, tz) : null;
    });
    stats.rules += 1;
    if (capped) stats.capped += 1;
    if (unbounded) stats.unbounded += 1;
    if (uid) expandedUids.add(uid);

    const instances: ParsedIcsEvent[] = [];
    for (const at of dates) {
      if (
        replacedAt.some(
          (r) =>
            r && r.date === at.date && (r.time === null || at.time === null || r.time === at.time),
        )
      )
        continue;
      const event = instanceEvent(master, at);
      instances.push({
        ...event,
        uid: instanceUid(uid, event.date),
        recurring: true,
        recurrenceKey: key,
      });
    }
    replaced.forEach((o, i) => {
      const built = buildEvent(o, tz);
      if ("reason" in built) return void skipped.push(built);
      const at = replacedAt[i];
      const idDate = at ? localDate(at, space, tz) : built.event.date;
      instances.push({
        ...built.event,
        uid: instanceUid(uid, idDate),
        recurring: true,
        recurrenceKey: key,
      });
    });
    instances.sort(
      (a, b) => a.date.localeCompare(b.date) || a.timeBegin.localeCompare(b.timeBegin),
    );
    if (instances[0]) firstInstances.add(instances[0]);
    stats.instances += instances.length;
    events.push(...instances);
  });

  // RECURRENCE-ID entries without a master in the file: single events (one per instance UID)
  vevents.forEach((props) => {
    const rid = first(props, "RECURRENCE-ID");
    if (!rid) return;
    const uid = first(props, "UID")?.value.trim() ?? "";
    if (uid && expandedUids.has(uid)) return;
    const built = buildEvent(props, tz);
    if ("reason" in built) return void skipped.push(built);
    const when = parseWhen(rid);
    const space = spaceOf(built.start, tz);
    const idDate =
      when && when !== "invalid"
        ? localDate(inSpace(when, space, tz), space, tz)
        : built.event.date;
    events.push({ ...built.event, uid: instanceUid(uid, idDate) });
  });

  // At most IMPORT_MAX events per file: later instances of recurrences give way
  if (events.length > IMPORT_MAX) {
    let budget = IMPORT_MAX - events.filter((e) => !e.recurring || firstInstances.has(e)).length;
    const kept = events.filter((e) => {
      if (!e.recurring || firstInstances.has(e)) return true;
      budget -= 1;
      return budget >= 0;
    });
    stats.dropped = events.length - kept.length;
    stats.instances -= stats.dropped;
    events.length = 0;
    events.push(...kept);
  }

  return { events, skipped, recurrence: stats };

  /** Date of an instance as it is imported (UTC times in the calendar's zone). */
  function localDate(
    at: { date: IsoDate; time: string | null },
    space: Space,
    zone: string | null | undefined,
  ): IsoDate {
    if (space.kind === "utc" && at.time && zone) return utcToZone(at.date, at.time, zone).date;
    return at.date;
  }

  /** The master's values moved to another instance (same duration; UTC times converted per instance). */
  function instanceEvent(
    master: Built,
    at: { date: IsoDate; time: string | null },
  ): ParsedIcsEvent {
    const ev = master.event;
    if (at.date === master.start.date && at.time === master.start.time) return ev;
    if (ev.isAllDay) {
      const span = ev.dateEnd ? toDay(ev.dateEnd) - toDay(ev.date) : 0;
      return { ...ev, date: at.date, dateEnd: span > 0 ? fromDay(toDay(at.date) + span) : "" };
    }
    // Duration of the master in minutes (wall clock of the imported values)
    const span = naiveMs(ev.dateEnd || ev.date, ev.timeEnd) - naiveMs(ev.date, ev.timeBegin);
    const startTime = at.time ?? master.start.time ?? ev.timeBegin;
    let s: { date: IsoDate; time: string };
    let e: { date: IsoDate; time: string };
    if (master.start.utc && tz) {
      const startMs = naiveMs(at.date, startTime);
      const end = fromNaiveMs(startMs + span);
      s = utcToZone(at.date, startTime, tz);
      e = utcToZone(end.date, end.time, tz);
    } else {
      s = { date: at.date, time: startTime };
      e = fromNaiveMs(naiveMs(at.date, startTime) + span);
    }
    return {
      ...ev,
      date: s.date,
      dateEnd: e.date > s.date ? e.date : "",
      timeBegin: s.time,
      timeEnd: e.time,
    };
  }
}

interface Built {
  event: ParsedIcsEvent;
  start: When;
}

/** One event from a VEVENT's DTSTART / DTEND / DURATION (the first instance of a recurrence). */
function buildEvent(props: Props, tz: string | null | undefined): Built | SkippedIcsEvent {
  const name = unescapeIcsText(first(props, "SUMMARY")?.value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const start = parseWhen(first(props, "DTSTART"));
  if (start === "invalid") return { reason: "invalidDate", name };
  if (!start) return { reason: "noDate", name };
  if (!name) return { reason: "noName", name };

  const end = parseWhen(first(props, "DTEND"));
  const s = localize(start, tz);
  const allDay = s.time === null;
  let dateEnd: IsoDate | "" = "";
  let timeBegin = "00:00";
  let timeEnd = "23:59";

  // DURATION replaces DTEND (RFC 5545 3.6.1): the end is the start plus the duration.
  const duration = end ? null : parseDuration(first(props, "DURATION")?.value ?? "");

  if (allDay) {
    let last: IsoDate | null = null;
    if (end && end !== "invalid") {
      // All-day DTEND is exclusive.
      last = addDays(end.date, -1);
    } else if (duration) {
      const days = duration.days + Math.trunc(duration.minutes / 1440);
      last = addDays(s.date, days - 1);
    }
    if (last && last > s.date) dateEnd = last;
  } else {
    timeBegin = s.time!;
    timeEnd = timeBegin;
    if (end && end !== "invalid" && end.time) {
      const e = localize(end, tz);
      if (e.date > s.date) dateEnd = e.date;
      timeEnd = e.time ?? timeBegin;
    } else if (duration) {
      const at = fromNaiveMs(
        naiveMs(s.date, timeBegin) + (duration.days * 1440 + duration.minutes) * 60_000,
      );
      if (at.date > s.date) dateEnd = at.date;
      timeEnd = at.time;
    }
  }

  const locationText = unescapeIcsText(first(props, "LOCATION")?.value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const note = unescapeIcsText(first(props, "DESCRIPTION")?.value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, NOTE_MAX);
  return {
    start,
    event: {
      uid: first(props, "UID")?.value.trim() ?? "",
      name,
      date: s.date,
      dateEnd,
      isAllDay: allDay,
      timeBegin,
      timeEnd,
      timezone: start.tzid,
      locationText,
      note,
      recurring: false,
      recurrenceKey: null,
      recurrenceUnsupported: false,
    },
  };
}

/** Whether a file looks like an ICS file (by name or MIME type). */
export function isIcsFile(file: Pick<File, "name" | "type">): boolean {
  return /\.ics$/i.test(file.name) || file.type === "text/calendar";
}
