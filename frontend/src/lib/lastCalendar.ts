/**
 * The calendar last used per club, remembered in this browser (the account only stores one last
 * club/calendar pair). Used when switching clubs so the target club opens where you left it.
 * Storage may be unavailable (private mode, blocked), so every access is guarded.
 */
const KEY_PREFIX = "lastCalendar:";

/** Keyed per user as well: accounts sharing a browser (or a club) must not see each other's choice. */
const storageKey = (userId: string, clubId: string) => `${KEY_PREFIX}${userId}:${clubId}`;

export function readLastCalendar(userId: string | undefined, clubId: string): string | null {
  if (!userId) return null;
  try {
    return window.localStorage.getItem(storageKey(userId, clubId));
  } catch {
    return null;
  }
}

export function rememberLastCalendar(
  userId: string | undefined,
  clubId: string,
  calendarId: string,
): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(storageKey(userId, clubId), calendarId);
  } catch {
    /* not available: the first calendar is the fallback */
  }
}
