import { useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  isWeekend,
  itemsOnDay,
  layoutWeek,
  monthGrid,
  parseIso,
  sameMonth,
  weekdayNames,
  type CalItem,
  type IsoDate,
  type WeekStart,
  type YearMonth,
} from "@/lib/calendar";
import { EventChip } from "./EventChip";
import { dayCellLabel } from "./dayLabel";
import { useTouchDrag } from "./useTouchDrag";
import { useGridKeyboard } from "./useGridKeyboard";
import { useLocale } from "./useLocale";

const MAX_LANES = 3;

export interface MonthBoardProps {
  month: YearMonth;
  weekStart: WeekStart;
  items: CalItem[];
  today: IsoDate;
  /** Date in the tab order (roving tabindex). */
  activeDate: IsoDate;
  /** Day whose details are shown (aria-selected). */
  selectedDate: IsoDate | null;
  /** id of the element naming the grid (the month title). */
  labelledBy: string;
  onMoveFocus: (date: IsoDate) => void;
  onActivateDay: (date: IsoDate) => void;
  onOpenItem: (item: CalItem) => void;
  /** Mouse shortcut: double click on a day opens "new event" for it (absent: no shortcut). */
  onCreateOnDay?: (date: IsoDate) => void;
  /** Enables dragging events to another day. */
  onDropItem?: (item: CalItem, date: IsoDate) => void;
}

function columnAt(e: { clientX: number; currentTarget: HTMLElement }): number {
  const rect = e.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return -1;
  return Math.min(6, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * 7)));
}

/**
 * Large month grid for desktop/tablet (design: MonthView.dc.html, ap-month). A role="grid"
 * of day cells with a roving tabindex; events are bars spanning their days. The bars are
 * pointer shortcuts: keyboard and screen reader users open the day (Enter) and reach its
 * events in the day panel.
 */
export function MonthBoard({
  month,
  weekStart,
  items,
  today,
  activeDate,
  selectedDate,
  labelledBy,
  onMoveFocus,
  onActivateDay,
  onOpenItem,
  onCreateOnDay,
  onDropItem,
}: MonthBoardProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const weeks = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const shortNames = weekdayNames(locale, weekStart, "short");
  const longNames = weekdayNames(locale, weekStart, "long");
  const { gridRef, onKeyDown } = useGridKeyboard({
    activeDate,
    weekStart,
    onMove: onMoveFocus,
    onActivate: onActivateDay,
  });
  const dragged = useRef<CalItem | null>(null);
  const [dropDate, setDropDate] = useState<IsoDate | null>(null);
  const canDrag = !!onDropItem;
  const touchDrag = useTouchDrag({ items, onDrop: onDropItem, onTarget: setDropDate });

  function onBodyClick(e: MouseEvent<HTMLDivElement>, week: IsoDate[]) {
    if (e.target !== e.currentTarget) return;
    const col = columnAt(e);
    if (col >= 0) onActivateDay(week[col]);
  }

  function onBodyDoubleClick(e: MouseEvent<HTMLDivElement>, week: IsoDate[]) {
    if (!onCreateOnDay || e.target !== e.currentTarget) return;
    const col = columnAt(e);
    if (col >= 0) onCreateOnDay(week[col]);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>, week: IsoDate[]) {
    if (!dragged.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const col = columnAt(e);
    if (col >= 0 && week[col] !== dropDate) setDropDate(week[col]);
  }

  function onDrop(e: DragEvent<HTMLDivElement>, week: IsoDate[]) {
    const item = dragged.current;
    dragged.current = null;
    setDropDate(null);
    if (!item || !onDropItem) return;
    e.preventDefault();
    const col = columnAt(e);
    if (col >= 0 && week[col] !== item.start) onDropItem(item, week[col]);
  }

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-labelledby={labelledBy}
      className="ap-month"
      onKeyDown={onKeyDown}
      onPointerDown={canDrag ? touchDrag.onPointerDown : undefined}
    >
      <div role="row" className="ap-month-head">
        {shortNames.map((name, i) => (
          <span key={name} role="columnheader" aria-label={longNames[i]}>
            {name}
          </span>
        ))}
      </div>
      {weeks.map((week) => {
        const { segments, overflow } = layoutWeek(items, week, MAX_LANES);
        return (
          <div role="row" className="ap-wk" key={week[0]}>
            <div className="ap-wk-bg" aria-hidden="true">
              {week.map((day) => (
                <i
                  key={day}
                  className={cn(
                    isWeekend(day) && "we",
                    day === selectedDate && "sel",
                    day === dropDate && "drop",
                  )}
                />
              ))}
            </div>
            <div
              className="ap-wk-body"
              data-days={week.join(",")}
              onClick={(e) => onBodyClick(e, week)}
              onDoubleClick={(e) => onBodyDoubleClick(e, week)}
              onDragOver={canDrag ? (e) => onDragOver(e, week) : undefined}
              onDrop={canDrag ? (e) => onDrop(e, week) : undefined}
            >
              {week.map((day, i) => {
                const inMonth = sameMonth(day, month);
                return (
                  <div
                    key={day}
                    role="gridcell"
                    aria-selected={day === selectedDate}
                    className={cn(
                      "ap-dayno",
                      !inMonth && "ap-dayno--muted",
                      day === today && "ap-dayno--today",
                    )}
                    style={{ gridColumn: i + 1, gridRow: 1 }}
                  >
                    <button
                      type="button"
                      data-date={day}
                      tabIndex={day === activeDate ? 0 : -1}
                      aria-label={dayCellLabel(day, itemsOnDay(items, day), { locale, today, t })}
                      aria-current={day === today ? "date" : undefined}
                      onClick={() => onActivateDay(day)}
                      onDoubleClick={onCreateOnDay ? () => onCreateOnDay(day) : undefined}
                    >
                      <span>{parseIso(day).day}</span>
                    </button>
                  </div>
                );
              })}
              {segments.map((seg) => (
                <EventChip
                  key={`${seg.item.id}-${week[0]}`}
                  item={seg.item}
                  presentational
                  timeLabel={
                    !seg.item.allDay && !seg.continuesBefore ? seg.item.timeBegin : undefined
                  }
                  continuesBefore={seg.continuesBefore}
                  continuesAfter={seg.continuesAfter}
                  onOpen={onOpenItem}
                  draggable={canDrag && seg.item.kind === "event" && !seg.continuesBefore}
                  onDragStart={(e, item) => {
                    dragged.current = item;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragEnd={() => {
                    dragged.current = null;
                    setDropDate(null);
                  }}
                  style={{
                    gridColumn: `${seg.startCol + 1} / span ${seg.endCol - seg.startCol + 1}`,
                    gridRow: seg.lane + 2,
                  }}
                />
              ))}
              {overflow.map((n, col) =>
                n > 0 ? (
                  <button
                    key={`more-${week[col]}`}
                    type="button"
                    className="ap-more"
                    aria-hidden="true"
                    tabIndex={-1}
                    style={{ gridColumn: col + 1, gridRow: MAX_LANES + 2 }}
                    onClick={() => onActivateDay(week[col])}
                  >
                    {t("calendar.more", { count: n })}
                  </button>
                ) : null,
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
