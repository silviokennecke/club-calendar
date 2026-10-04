/**
 * ICS parsing for the import (pure, no React). The backend has no dry run for imports, so the
 * file is parsed and checked in the browser; only the reviewed events are sent to
 * `POST …/events/import`.
 */
import { addDays, isValidIso, type IsoDate } from "@/lib/calendar";
import { windowsZoneToIana } from "./windowsZones";

export interface ParsedIcsEvent {
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
  /** The event carries an RRULE; only its first occurrence is in the file's list. */
  recurring: boolean;
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
  if (!/^[A-Za-z_]+(?:[/+-][A-Za-z0-9_+-]+)*$/.test(tzid)) return null;
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

/** Converts a UTC date and time to the wall clock of `timeZone` (unknown zones stay UTC). */
export function utcToZone(
  date: IsoDate,
  time: string,
  timeZone: string,
): { date: IsoDate; time: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(`${date}T${time}:00Z`));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    return {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      time: `${get("hour")}:${get("minute")}`,
    };
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

/** Parses all VEVENTs; events that cannot be imported are reported in `skipped`. */
export function parseIcs(text: string, options: IcsParseOptions = {}): IcsParseResult {
  const events: ParsedIcsEvent[] = [];
  const skipped: SkippedIcsEvent[] = [];
  let current: Map<string, Prop> | null = null;
  /** Depth of nested components (VALARM) inside the current VEVENT. */
  let nested = 0;
  let counter = 0;

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
      counter += 1;
      collect(current, counter);
      current = null;
      continue;
    }
    const parsed = parseLine(line);
    if (parsed && !current.has(parsed.name)) current.set(parsed.name, parsed.prop);
  }

  function collect(props: Map<string, Prop>, n: number) {
    const name = unescapeIcsText(props.get("SUMMARY")?.value ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const start = parseWhen(props.get("DTSTART"));
    if (start === "invalid") return void skipped.push({ reason: "invalidDate", name });
    if (!start) return void skipped.push({ reason: "noDate", name });
    if (!name) return void skipped.push({ reason: "noName", name });

    const end = parseWhen(props.get("DTEND"));
    const tz = options.timeZone;
    const s = localize(start, tz);
    const allDay = s.time === null;
    let dateEnd: IsoDate | "" = "";
    let timeBegin = "00:00";
    let timeEnd = "23:59";

    // DURATION replaces DTEND (RFC 5545 3.6.1): the end is the start plus the duration.
    const duration = end ? null : parseDuration(props.get("DURATION")?.value ?? "");

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
        const [y, mo, d] = s.date.split("-").map(Number);
        const [h, mi] = timeBegin.split(":").map(Number);
        const at = new Date(
          Date.UTC(y, mo - 1, d, h, mi + duration.days * 1440 + duration.minutes),
        );
        const iso = at.toISOString();
        if (iso.slice(0, 10) > s.date) dateEnd = iso.slice(0, 10);
        timeEnd = iso.slice(11, 16);
      }
    }

    const locationText = unescapeIcsText(props.get("LOCATION")?.value ?? "")
      .replace(/\s+/g, " ")
      .trim();
    events.push({
      uid: props.get("UID")?.value.trim() || `imported-${n}`,
      name,
      date: s.date,
      dateEnd,
      isAllDay: allDay,
      timeBegin,
      timeEnd,
      timezone: start.tzid,
      locationText,
      recurring: props.has("RRULE"),
    });
  }

  return { events, skipped };
}

/** Whether a file looks like an ICS file (by name or MIME type). */
export function isIcsFile(file: Pick<File, "name" | "type">): boolean {
  return /\.ics$/i.test(file.name) || file.type === "text/calendar";
}
