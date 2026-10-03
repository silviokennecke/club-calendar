const FALLBACK_ZONES = [
  "Europe/Berlin",
  "Europe/Vienna",
  "Europe/Zurich",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "UTC",
];

/** All IANA time zones the browser knows (short fallback list on old browsers). */
export function timeZoneList(extra?: string | null): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  let zones: string[];
  try {
    zones = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : FALLBACK_ZONES;
  } catch {
    zones = FALLBACK_ZONES;
  }
  if (!zones.includes("UTC")) zones = [...zones, "UTC"];
  return extra && !zones.includes(extra) ? [extra, ...zones] : zones;
}

/** Time ("14:32") and date ("Fr 02.10.2026") in a zone, for the time zone check; null for an unknown zone. */
export function formatClock(
  now: Date,
  timeZone: string,
  locale: string,
): { time: string; date: string } | null {
  try {
    const time = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(now);
    const date = new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
      .format(now)
      .replace(/^(\p{L}+)\.?,? /u, "$1 ");
    return { time, date };
  } catch {
    return null;
  }
}

/** "01.10.2026, 06:12" in the given zone. */
export function formatFetched(iso: string, timeZone: string | null, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, ...(timeZone ? { timeZone } : {}) }).format(
      date,
    );
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(date);
  }
}
