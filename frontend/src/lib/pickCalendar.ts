import type { Calendar } from "@/lib/types";

/**
 * Calendar a club opens when you switch to it: the one last used in that club (`rememberedId`, stored
 * at the membership: `lastCalendarId` of `GET /api/clubs`; only if it still exists and is not
 * archived), else the account's last calendar for its last club, else the first active one.
 */
export function pickCalendar(
  calendars: Calendar[],
  clubId: string,
  lastClubId?: string | null,
  lastCalendarId?: string | null,
  rememberedId?: string | null,
): Calendar | undefined {
  const remembered = rememberedId
    ? calendars.find((c) => c.id === rememberedId && !c.archivedAt)
    : undefined;
  if (remembered) return remembered;
  if (clubId === lastClubId) {
    const last = calendars.find((c) => c.id === lastCalendarId);
    if (last) return last;
  }
  return calendars.find((c) => !c.archivedAt) ?? calendars[0];
}
