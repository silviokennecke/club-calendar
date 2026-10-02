/** Small text helpers for event lists and dialogs (locale-aware, pure). */
import { formatNumericDate, toUtcMs, type IsoDate } from "@/lib/calendar";
import { formatAddress, type Location } from "@/lib/types";

/** Display name of a location: its name, else the address. */
export function locationName(
  loc: Pick<Location, "name" | "street" | "zip" | "city" | "country">,
): string {
  return loc.name || formatAddress(loc);
}

/** "A, B und C" / "A, B and C". */
export function joinList(items: string[], and: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

/** "17.10." / "10/17". */
export function formatShortDate(iso: IsoDate, locale: string): string {
  const s = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
  }).format(toUtcMs(iso));
  return locale.startsWith("de") && !s.endsWith(".") ? `${s}.` : s;
}

/** "10.10.2026" or "10.10.2026 – 11.10.2026" for multi-day events. */
export function formatEventDates(
  ev: { date: string; dateEnd?: string | null },
  locale: string,
): string {
  const start = ev.date.slice(0, 10);
  const end = ev.dateEnd ? ev.dateEnd.slice(0, 10) : start;
  const first = formatNumericDate(start, locale);
  return end > start ? `${first} – ${formatNumericDate(end, locale)}` : first;
}

/** "Mi 14.10.2026" / "Wed 10/14/2026". */
export function formatWeekdayDate(iso: IsoDate, locale: string): string {
  const wd = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" })
    .format(toUtcMs(iso))
    .replace(/\.$/, "");
  return `${wd} ${formatNumericDate(iso, locale)}`;
}
