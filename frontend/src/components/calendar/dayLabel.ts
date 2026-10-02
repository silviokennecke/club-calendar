import type { TFunction } from "i18next";
import { formatDayMonth, type CalItem, type IsoDate } from "@/lib/calendar";

/**
 * Accessible name of a day cell: "8. Oktober, heute, 2 Termine, Feiertag Reformationstag".
 */
export function dayCellLabel(
  date: IsoDate,
  items: CalItem[],
  opts: { locale: string; today: IsoDate; t: TFunction },
): string {
  const { locale, today, t } = opts;
  const events = items.filter((i) => i.kind === "event").length;
  const holidays = items.filter((i) => i.kind === "holiday");
  return [
    formatDayMonth(date, locale),
    date === today ? t("calendar.cell.today") : null,
    events > 0 ? t("calendar.cell.events", { count: events }) : null,
    ...holidays.map((h) => t("calendar.cell.holiday", { name: h.title })),
  ]
    .filter(Boolean)
    .join(", ");
}
