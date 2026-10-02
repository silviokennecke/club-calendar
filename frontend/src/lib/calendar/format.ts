/**
 * Locale-aware labels for the calendar (month and weekday names via Intl in the current
 * language). Dates are formatted in UTC from ISO dates, so the browser's zone never shifts them.
 */
import {
  addDays,
  toUtcMs,
  weekdayOrder,
  type IsoDate,
  type WeekStart,
  type YearMonth,
} from "./dates";

function fmt(locale: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options });
}

function stripDot(s: string): string {
  return s.replace(/\.$/, "");
}

/** "Oktober 2026" / "October 2026". */
export function formatMonthTitle(ym: YearMonth, locale: string): string {
  return fmt(locale, { month: "long", year: "numeric" }).format(Date.UTC(ym.year, ym.month, 1));
}

/** "Oktober" / "October". */
export function formatMonthName(ym: YearMonth, locale: string): string {
  return fmt(locale, { month: "long" }).format(Date.UTC(ym.year, ym.month, 1));
}

/** Weekday names in display order: short ("Mo", "Mon") or long ("Montag"). */
export function weekdayNames(
  locale: string,
  weekStart: WeekStart = 1,
  width: "short" | "long" = "short",
): string[] {
  const f = fmt(locale, { weekday: width });
  // 2023-01-01 was a Sunday.
  return weekdayOrder(weekStart).map((d) => {
    const name = f.format(Date.UTC(2023, 0, 1 + d));
    return width === "short" ? stripDot(name) : name;
  });
}

/** "8. Oktober" / "October 8". */
export function formatDayMonth(iso: IsoDate, locale: string): string {
  return fmt(locale, { day: "numeric", month: "long" }).format(toUtcMs(iso));
}

/** "Donnerstag, 8. Oktober" / "Thursday, October 8". */
export function formatWeekdayDayMonth(iso: IsoDate, locale: string): string {
  return fmt(locale, { weekday: "long", day: "numeric", month: "long" }).format(toUtcMs(iso));
}

/** "16.10.2026" / "10/16/2026". */
export function formatNumericDate(iso: IsoDate, locale: string): string {
  return fmt(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(toUtcMs(iso));
}

/** Short month for date badges: "Okt" / "Oct". */
export function formatShortMonth(iso: IsoDate, locale: string): string {
  return stripDot(fmt(locale, { month: "short" }).format(toUtcMs(iso)));
}

/** Week column heading: "Mo 05.10." / "Mon 10/05". */
export function formatWeekColumn(iso: IsoDate, locale: string): string {
  const wd = stripDot(fmt(locale, { weekday: "short" }).format(toUtcMs(iso)));
  const dm = fmt(locale, { day: "2-digit", month: "2-digit" }).format(toUtcMs(iso));
  return `${wd} ${dm}${locale.startsWith("de") && !dm.endsWith(".") ? "." : ""}`;
}

/** Date range of a week: "05.–11.10.2026" / "10/05/2026 – 10/11/2026". */
export function formatWeekRange(weekStartDay: IsoDate, locale: string): string {
  const f = fmt(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  const from = toUtcMs(weekStartDay);
  const to = toUtcMs(addDays(weekStartDay, 6));
  // formatRange is ES2021 (all supported browsers); typed loosely for the configured lib.
  const ranged = f as Intl.DateTimeFormat & { formatRange?: (a: number, b: number) => string };
  return typeof ranged.formatRange === "function"
    ? ranged.formatRange(from, to)
    : `${f.format(from)} – ${f.format(to)}`;
}
