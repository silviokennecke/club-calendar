/**
 * Removes values older releases kept in this browser: the last calendar per club
 * (`lastCalendar:<userId>:<clubId>`) now lives at the membership on the server (`GET /api/clubs`).
 * Storage may be unavailable (private mode, blocked), so every access is guarded.
 */
export function purgeLegacyStorage(
  storage: Pick<Storage, "length" | "key" | "removeItem"> = window.localStorage,
) {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith("lastCalendar:")) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* not available: nothing to clean up */
  }
}
