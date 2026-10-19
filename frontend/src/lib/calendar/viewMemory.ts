/**
 * Remembers the shown month / week per calendar for the browser session (sessionStorage), so the
 * calendar page can return to it after a visit to another page. Never throws.
 */
import { isValidIso, type IsoDate } from "./dates";
import type { CalendarView } from "./view";

export interface RememberedView {
  view: CalendarView;
  date: IsoDate;
}

const key = (calendarId: string) => `calendarView:${calendarId}`;

export function storeCalendarView(calendarId: string, value: RememberedView): void {
  try {
    sessionStorage.setItem(key(calendarId), JSON.stringify(value));
  } catch {
    // storage unavailable or full: remembering is a convenience only
  }
}

/** The remembered view, or null when nothing (valid) is stored. */
export function readCalendarView(calendarId: string): RememberedView | null {
  try {
    const raw = sessionStorage.getItem(key(calendarId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { view, date } = parsed as Record<string, unknown>;
    if (view !== "month" && view !== "week") return null;
    if (typeof date !== "string" || !isValidIso(date)) return null;
    return { view, date: date.slice(0, 10) };
  } catch {
    return null;
  }
}
