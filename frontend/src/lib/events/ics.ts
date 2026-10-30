/**
 * Export helpers (design: Export): the selection rule of the export (for the count preview and the
 * query of `GET …/events.ics`, which builds the file in the backend) and the download helpers.
 */
import { daysInMonth, isValidIso, parseIso, type IsoDate } from "@/lib/calendar";
import type { CalendarEvent } from "@/lib/types";
import { matchesGroups } from "./list";

export type ExportRange = "all" | "month" | "year" | "nextYear" | "custom";

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

/** The date range of the export options (each side optional), as the backend filters it. */
export function exportRange(opts: ExportOptions): { from?: IsoDate; to?: IsoDate } {
  if (opts.range === "month") {
    const [from, to] = monthBounds(opts.today);
    return { from, to };
  }
  if (opts.range === "year" || opts.range === "nextYear") {
    const year = String(
      Number(opts.today.slice(0, 4)) + (opts.range === "nextYear" ? 1 : 0),
    ).padStart(4, "0");
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  if (opts.range === "custom") {
    return {
      from: isValidIso(opts.from) ? opts.from : undefined,
      to: isValidIso(opts.to) ? opts.to : undefined,
    };
  }
  return {};
}

/** Query string of `GET /api/calendars/{id}/events.ics` for the export options. */
export function exportQuery(opts: ExportOptions): string {
  const { from, to } = exportRange(opts);
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (opts.includeDrafts) params.set("includeDrafts", "1");
  for (const id of opts.groupIds) params.append("targetGroupIds[]", id);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Events that land in the export file (an event counts when it overlaps the range). */
export function selectForExport<T extends CalendarEvent>(events: T[], opts: ExportOptions): T[] {
  const { from, to } = exportRange(opts);
  return events.filter((ev) => {
    const start = ev.date.slice(0, 10);
    const end = ev.dateEnd ? ev.dateEnd.slice(0, 10) : start;
    if (from && end < from) return false;
    if (to && start > to) return false;
    if (!opts.includeDrafts && ev.isDraft) return false;
    return matchesGroups(ev, opts.groupIds);
  });
}

/** File name like "schiessbetrieb-2026.pdf". */
export function exportFileName(name: string, ext: "ics" | "pdf"): string {
  const slug = name
    .normalize("NFKD")
    .replace(/ß/g, "ss")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "termine"}.${ext}`;
}

/** File name like "schiessbetrieb-2026.ics". */
export function icsFileName(name: string): string {
  return exportFileName(name, "ics");
}

/** Triggers a browser download of a blob (`a[download]` with an object URL). */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
