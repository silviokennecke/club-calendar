import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  itemsOnDay,
  monthGrid,
  parseIso,
  sameMonth,
  weekdayNames,
  type CalItem,
  type IsoDate,
  type WeekStart,
  type YearMonth,
} from "@/lib/calendar";
import { dayCellLabel } from "./dayLabel";
import { useGridKeyboard } from "./useGridKeyboard";
import { useLocale } from "./useLocale";

export interface MonthGridProps {
  month: YearMonth;
  weekStart: WeekStart;
  items: CalItem[];
  today: IsoDate;
  activeDate: IsoDate;
  selectedDate: IsoDate | null;
  labelledBy: string;
  onMoveFocus: (date: IsoDate) => void;
  onSelectDay: (date: IsoDate) => void;
}

/**
 * Compact month grid (design-system MonthGrid, used on phones): 44px day buttons with up to
 * three dots for the day's events, today framed, the selected day filled. role="grid" with a
 * roving tabindex; arrow keys move, Enter/Space selects.
 */
export function MonthGrid({
  month,
  weekStart,
  items,
  today,
  activeDate,
  selectedDate,
  labelledBy,
  onMoveFocus,
  onSelectDay,
}: MonthGridProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const weeks = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const shortNames = weekdayNames(locale, weekStart, "short");
  const longNames = weekdayNames(locale, weekStart, "long");
  const { gridRef, onKeyDown } = useGridKeyboard({
    activeDate,
    weekStart,
    onMove: onMoveFocus,
    onActivate: onSelectDay,
  });

  return (
    <div className="cc-cal">
      <div
        ref={gridRef}
        role="grid"
        aria-labelledby={labelledBy}
        className="cc-grid"
        onKeyDown={onKeyDown}
      >
        <div role="row">
          {shortNames.map((name, i) => (
            <span key={name} role="columnheader" className="cc-wd" aria-label={longNames[i]}>
              {name}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" key={week[0]}>
            {week.map((day) => {
              if (!sameMonth(day, month)) return <span key={day} role="gridcell" />;
              const dayItems = itemsOnDay(items, day);
              const dots = Math.min(3, dayItems.filter((i) => i.kind === "event").length);
              const selected = day === selectedDate;
              return (
                <span key={day} role="gridcell" aria-selected={selected}>
                  <button
                    type="button"
                    data-date={day}
                    tabIndex={day === activeDate ? 0 : -1}
                    className={cn(
                      "cc-day",
                      day === today && "cc-day--today",
                      selected && "cc-day--selected",
                    )}
                    aria-label={dayCellLabel(day, dayItems, { locale, today, t })}
                    aria-current={day === today ? "date" : undefined}
                    onClick={() => onSelectDay(day)}
                  >
                    {parseIso(day).day}
                    {dots > 0 && (
                      <span className="cc-dots" aria-hidden="true">
                        {Array.from({ length: dots }, (_, k) => (
                          <i key={k} />
                        ))}
                      </span>
                    )}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
