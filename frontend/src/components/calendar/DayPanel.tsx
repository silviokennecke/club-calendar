import { forwardRef, useId, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatWeekdayDayMonth, type CalItem, type IsoDate } from "@/lib/calendar";
import { Button, IconButton } from "@/components/ui/shared";
import { EventItem, type EventItemTag } from "./EventItem";
import { useLocale } from "./useLocale";

interface DayPanelProps {
  date: IsoDate;
  items: CalItem[];
  onOpenItem: (item: CalItem) => void;
  /** Shown when events may be created ("Termin an diesem Tag anlegen"). */
  onCreate?: (date: IsoDate) => void;
  /** Desktop: close button + Escape. Omitted on phones (the list is always shown). */
  onClose?: () => void;
  placeOf?: (item: CalItem) => string | null | undefined;
  tagsOf?: (item: CalItem) => EventItemTag[];
  className?: string;
}

/**
 * Details of one day (design: MonthView mobile day list): heading with the weekday and date,
 * the day's events as cards, an empty note and the create action. The heading can receive
 * focus (ref) when the panel is opened from the grid.
 */
export const DayPanel = forwardRef<HTMLHeadingElement, DayPanelProps>(function DayPanel(
  { date, items, onOpenItem, onCreate, onClose, placeOf, tagsOf, className },
  headingRef,
) {
  const { t } = useTranslation();
  const locale = useLocale();
  const headingId = `day-${useId().replace(/:/g, "")}`;

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape" && onClose) {
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <section
      className={cn("ap-daypanel", className)}
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
    >
      <div className="ap-daypanel-head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="t-h3">
          {formatWeekdayDayMonth(date, locale)}
        </h2>
        {onClose && <IconButton icon="x" label={t("calendar.dayPanel.close")} onClick={onClose} />}
      </div>
      {items.length === 0 ? (
        <p className="t-sm t-muted">{t("calendar.dayPanel.empty")}</p>
      ) : (
        <ul className="ap-stack ap-stack--sm" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((item) => (
            <li key={item.id}>
              <EventItem
                item={item}
                day={date}
                place={placeOf?.(item)}
                tags={tagsOf?.(item)}
                onOpen={onOpenItem}
              />
            </li>
          ))}
        </ul>
      )}
      {onCreate && (
        <div>
          <Button variant="secondary" icon="plus" onClick={() => onCreate(date)}>
            {t("calendar.dayPanel.create")}
          </Button>
        </div>
      )}
    </section>
  );
});
