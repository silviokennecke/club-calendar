import type { Calendar } from "@/lib/types";

/** Calendar a club card opens: the last used one for the last club, else the first active one. */
export function pickCalendar(
  calendars: Calendar[],
  clubId: string,
  lastClubId?: string | null,
  lastCalendarId?: string | null,
): Calendar | undefined {
  if (clubId === lastClubId) {
    const last = calendars.find((c) => c.id === lastCalendarId);
    if (last) return last;
  }
  return calendars.find((c) => !c.archivedAt) ?? calendars[0];
}
