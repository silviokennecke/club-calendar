/**
 * Client-side export (design: Export): selection of events and an iCalendar (RFC 5545) file.
 * The backend has no export endpoint; the file is built from the loaded events, mirroring the
 * feed output of backend/src/Service/IcsService.php (UID, summary with icons, description).
 * Timed events are written in UTC (converted from the event's zone), so no VTIMEZONE is needed.
 */
import { addDays, daysInMonth, isValidIso, parseIso, type IsoDate } from "@/lib/calendar";
import type { CalendarEvent, Location } from "@/lib/types";
import { formatAddress } from "@/lib/types";
import { matchesGroups } from "./list";

export type ExportRange = "all" | "month" | "custom";

export interface ExportOptions {
  range: ExportRange;
  /** For "month": any day of the month (usually today). */
  today: IsoDate;
  /** For "custom" (each side optional). */
  from?: string;
  to?: string;
  includeDrafts: boolean;
  groupIds: string[];
}

/** First and last day of the month containing `day`. */
export function monthBounds(day: IsoDate): [IsoDate, IsoDate] {
  const { year, month } = parseIso(day);
  const first = `${day.slice(0, 7)}-01`;
  return [first, `${day.slice(0, 7)}-${String(daysInMonth(year, month)).padStart(2, "0")}`];
}

/** Events that land in the export file (an event counts when it overlaps the range). */
export function selectForExport<T extends CalendarEvent>(events: T[], opts: ExportOptions): T[] {
  let from: string | undefined;
  let to: string | undefined;
  if (opts.range === "month") [from, to] = monthBounds(opts.today);
  if (opts.range === "custom") {
    from = isValidIso(opts.from) ? opts.from : undefined;
    to = isValidIso(opts.to) ? opts.to : undefined;
  }
  return events.filter((ev) => {
    const start = ev.date.slice(0, 10);
    const end = ev.dateEnd ? ev.dateEnd.slice(0, 10) : start;
    if (from && end < from) return false;
    if (to && start > to) return false;
    if (!opts.includeDrafts && ev.isDraft) return false;
    return matchesGroups(ev, opts.groupIds);
  });
}

/** Offset of `timeZone` from UTC in minutes at the given instant. */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

/**
 * The UTC instant of a wall-clock time in a zone ("2026-10-01", "19:00", "Europe/Berlin" ->
 * 17:00 UTC). Unknown zones fall back to UTC.
 */
export function zonedTimeToUtc(date: IsoDate, time: string, timeZone: string | null): Date {
  const { year, month, day } = parseIso(date);
  const [h, m] = time.split(":").map(Number);
  const wall = Date.UTC(year, month, day, h || 0, m || 0);
  if (!timeZone) return new Date(wall);
  try {
    // Two passes handle the offset change around daylight saving time switches.
    let utc = wall - zoneOffsetMinutes(wall, timeZone) * 60_000;
    utc = wall - zoneOffsetMinutes(utc, timeZone) * 60_000;
    return new Date(utc);
  } catch {
    return new Date(wall);
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function utcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function dateValue(iso: IsoDate): string {
  return iso.replace(/-/g, "");
}

/** Escapes a TEXT value (RFC 5545 3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds a content line to at most 75 octets (UTF-8), continuation lines start with a space. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

function locationText(loc: Location): string {
  return [loc.name, formatAddress(loc)].filter(Boolean).join(", ");
}

export interface IcsOptions {
  calendarName: string;
  /** Fallback zone for events without their own (calendar or club zone). */
  timeZone: string | null;
  /** Labels in the user's language. */
  labels: { features: string; targetGroups: string };
  now?: Date;
}

function eventLines(ev: CalendarEvent, opts: IcsOptions, stamp: string): string[] {
  const start = ev.date.slice(0, 10);
  const end = ev.dateEnd ? ev.dateEnd.slice(0, 10) : start;
  const icons = ev.properties
    .map((p) => p.property.icon)
    .filter(Boolean)
    .join(" ");
  const lines = [
    "BEGIN:VEVENT",
    `UID:event-${ev.id}@club-calendar`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${escapeText(icons ? `${icons} ${ev.name}` : ev.name)}`,
  ];
  if (ev.isAllDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateValue(start)}`);
    lines.push(`DTEND;VALUE=DATE:${dateValue(addDays(end, 1))}`);
  } else {
    const zone = ev.timezone || opts.timeZone;
    lines.push(`DTSTART:${utcStamp(zonedTimeToUtc(start, ev.timeBegin, zone))}`);
    lines.push(`DTEND:${utcStamp(zonedTimeToUtc(end, ev.timeEnd, zone))}`);
  }
  const description = [
    ev.features.length > 0
      ? `${opts.labels.features}: ${ev.features.map((f) => f.feature.name).join(", ")}`
      : null,
    ev.targetGroups.length > 0
      ? `${opts.labels.targetGroups}: ${ev.targetGroups.map((g) => g.targetGroup.name).join(", ")}`
      : null,
  ].filter(Boolean);
  if (description.length > 0) lines.push(`DESCRIPTION:${escapeText(description.join("\n"))}`);
  if (ev.location) {
    const text = locationText(ev.location);
    if (text) lines.push(`LOCATION:${escapeText(text)}`);
    if (ev.location.latitude != null && ev.location.longitude != null)
      lines.push(`GEO:${ev.location.latitude};${ev.location.longitude}`);
  }
  lines.push(`STATUS:${ev.isDraft ? "TENTATIVE" : "CONFIRMED"}`);
  lines.push("END:VEVENT");
  return lines;
}

/** A complete VCALENDAR with CRLF line endings and folded lines. */
export function buildIcs(events: CalendarEvent[], opts: IcsOptions): string {
  const stamp = utcStamp(opts.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Club Calendar//Export//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
    ...(opts.timeZone ? [`X-WR-TIMEZONE:${opts.timeZone}`] : []),
    ...events.flatMap((ev) => eventLines(ev, opts, stamp)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** File name like "schiessbetrieb-2026.ics". */
export function icsFileName(calendarName: string): string {
  const slug = calendarName
    .normalize("NFKD")
    .replace(/ß/g, "ss")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "termine"}.ics`;
}

/** Triggers a browser download of a text file. */
export function downloadTextFile(content: string, fileName: string, type = "text/calendar") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
