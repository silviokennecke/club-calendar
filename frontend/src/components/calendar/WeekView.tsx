import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  formatWeekColumn,
  isWeekend,
  itemsOnDay,
  type CalItem,
  type IsoDate,
} from "@/lib/calendar";
import { EventChip } from "./EventChip";
import { useLocale } from "./useLocale";

interface WeekViewProps {
  days: IsoDate[];
  items: CalItem[];
  today: IsoDate;
  onOpenItem: (item: CalItem) => void;
}

/**
 * Week view (design: CalendarWeek.dc.html): one column per day with its events as buttons
 * (time, title, symbols, draft marker). Columns stack on phones.
 */
export function WeekView({ days, items, today, onOpenItem }: WeekViewProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const uid = useId().replace(/:/g, "");

  return (
    <section aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className="ap-sr">
        {t("calendar.week.heading")}
      </h2>
      <div className="ap-weekgrid">
        {days.map((day, i) => {
          const dayItems = itemsOnDay(items, day);
          const isToday = day === today;
          const headingId = `${uid}-d${i}`;
          return (
            <section
              key={day}
              className={cn(
                "ap-weekcol",
                isWeekend(day) && "ap-weekcol--we",
                isToday && "ap-weekcol--today",
              )}
              aria-labelledby={headingId}
              aria-current={isToday ? "date" : undefined}
            >
              <h3 id={headingId}>
                {formatWeekColumn(day, locale)}
                {isToday && (
                  <>
                    {" "}
                    <span className="ap-badge ap-badge--new">{t("calendar.today")}</span>
                  </>
                )}
              </h3>
              {dayItems.map((item) => (
                <EventChip
                  key={item.id}
                  item={item}
                  variant="block"
                  timeLabel={
                    item.kind === "event"
                      ? item.allDay || !item.timeBegin
                        ? t("calendar.time.allDay")
                        : item.timeBegin
                      : undefined
                  }
                  onOpen={onOpenItem}
                />
              ))}
              {dayItems.length === 0 && <p className="t-sm t-muted">{t("calendar.week.empty")}</p>}
            </section>
          );
        })}
      </div>
    </section>
  );
}
