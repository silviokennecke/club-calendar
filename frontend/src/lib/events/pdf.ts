/** PDF export (`GET …/events.pdf`): query, layout availability and error mapping. Rules mirror the backend. */
import { diffDays, isValidIso } from "@/lib/calendar";
import type { ApiError } from "@/lib/api";
import { exportQuery, type ExportOptions } from "./ics";

export type PdfLayout = "month-grid" | "annual-overview" | "quarter-overview" | "agenda";
export type PdfPaper = "a4" | "a3";
export type PdfOrientation = "auto" | "portrait" | "landscape";

export const PDF_LAYOUTS: PdfLayout[] = [
  "month-grid",
  "annual-overview",
  "quarter-overview",
  "agenda",
];
/** Backend caps (422 `too_many_events`, 400 on `to`). */
export const PDF_MAX_EVENTS = 2000;
export const PDF_MAX_DAYS = 366;

export interface PdfOptions extends ExportOptions {
  layout: PdfLayout;
  paper: PdfPaper;
  orientation: PdfOrientation;
}

/** Query string of `GET /api/calendars/{id}/events.pdf`: the export query plus layout, paper, orientation. */
export function pdfExportQuery(opts: PdfOptions): string {
  const base = exportQuery(opts);
  const extra = new URLSearchParams({
    layout: opts.layout,
    paper: opts.paper,
    orientation: opts.orientation,
  }).toString();
  return `${base || "?"}${base ? "&" : ""}${extra}`;
}

function touchedMonths(from: string, to: string): number {
  const f = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7));
  const t = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  return t - f + 1;
}

/** Which layouts the period allows: quarter needs at least 3 touched months, annual a full calendar year. */
export function availableLayouts(from?: string, to?: string): Record<PdfLayout, boolean> {
  const valid = isValidIso(from) && isValidIso(to) && from <= to;
  return {
    "month-grid": true,
    agenda: true,
    "quarter-overview": valid && touchedMonths(from, to) >= 3,
    "annual-overview":
      valid &&
      from.slice(5) === "01-01" &&
      to.slice(5) === "12-31" &&
      from.slice(0, 4) === to.slice(0, 4),
  };
}

/** True when `to` is more than 366 days after `from` (backend: 400 on `to`). */
export function pdfRangeTooLong(from?: string, to?: string): boolean {
  return isValidIso(from) && isValidIso(to) && diffDays(from, to) > PDF_MAX_DAYS;
}

export type PdfFailure = "tooMany" | "rangeTooLong" | "rateLimited" | "generic";

/** Maps a failed PDF request to a message key by the problem `code` (never `detail`). */
export function pdfFailure(err: unknown): { kind: PdfFailure; retryAfter?: number } {
  const e = err as Partial<ApiError> | null;
  if (e?.code === "too_many_events") return { kind: "tooMany" };
  if (e?.code === "validation_failed" && e.field === "to") return { kind: "rangeTooLong" };
  if (e?.code === "rate_limited") return { kind: "rateLimited", retryAfter: e.retryAfter };
  return { kind: "generic" };
}
