import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  itemsOnDay,
  type CalItem,
  type IsoDate,
  type WeekStart,
  type YearMonth,
} from "@/lib/calendar";
import { CalendarLegend } from "./CalendarLegend";
import { DayPanel } from "./DayPanel";
import type { EventItemTag } from "./EventItem";
import { MonthBoard } from "./MonthBoard";
import { MonthGrid } from "./MonthGrid";

export interface MonthViewProps {
  month: YearMonth;
  weekStart: WeekStart;
  items: CalItem[];
  today: IsoDate;
  activeDate: IsoDate;
  selectedDate: IsoDate;
  /** Desktop: the day panel next to the grid is open. Phones always show the day list. */
  panelOpen: boolean;
  /** Phones: compact grid + day list (design: MonthView mobile). */
  compact: boolean;
  labelledBy: string;
  onMoveFocus: (date: IsoDate) => void;
  /** Click / Enter on a day: select it (and open the panel on desktop). */
  onSelectDay: (date: IsoDate) => void;
  onClosePanel: () => void;
  onOpenItem: (item: CalItem) => void;
  onCreateOnDay?: (date: IsoDate) => void;
  onDropItem?: (item: CalItem, date: IsoDate) => void;
  placeOf?: (item: CalItem) => string | null | undefined;
  tagsOf?: (item: CalItem) => EventItemTag[];
  showHolidayLegend?: boolean;
}

/**
 * Month view: large grid with event bars and an optional day panel on desktop, compact grid
 * with the selected day's events on phones. Handles focus between grid and panel
 * (Enter opens the day and focuses its heading, Escape closes and returns to the day).
 */
export function MonthView({
  month,
  weekStart,
  items,
  today,
  activeDate,
  selectedDate,
  panelOpen,
  compact,
  labelledBy,
  onMoveFocus,
  onSelectDay,
  onClosePanel,
  onOpenItem,
  onCreateOnDay,
  onDropItem,
  placeOf,
  tagsOf,
  showHolidayLegend = true,
}: MonthViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);

  useEffect(() => {
    if (panelOpen && focusHeading.current) headingRef.current?.focus();
    focusHeading.current = false;
  }, [panelOpen, selectedDate]);

  function selectDay(date: IsoDate) {
    if (!compact) focusHeading.current = true;
    onSelectDay(date);
  }

  function closePanel() {
    onClosePanel();
    rootRef.current
      ?.querySelector<HTMLElement>(`[role="grid"] [data-date="${activeDate}"]`)
      ?.focus();
  }

  const dayItems = itemsOnDay(items, selectedDate);
  const panel = (
    <DayPanel
      ref={headingRef}
      date={selectedDate}
      items={dayItems}
      onOpenItem={onOpenItem}
      onCreate={onCreateOnDay}
      onClose={compact ? undefined : closePanel}
      placeOf={placeOf}
      tagsOf={tagsOf}
      className={compact ? undefined : "ap-panel"}
    />
  );

  if (compact) {
    return (
      <div ref={rootRef} className="ap-stack">
        <MonthGrid
          month={month}
          weekStart={weekStart}
          items={items}
          today={today}
          activeDate={activeDate}
          selectedDate={selectedDate}
          labelledBy={labelledBy}
          onMoveFocus={onMoveFocus}
          onSelectDay={selectDay}
        />
        {panel}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && panelOpen) closePanel();
      }}
    >
      <div className={cn("ap-calsplit", panelOpen && "ap-calsplit--open")}>
        <MonthBoard
          month={month}
          weekStart={weekStart}
          items={items}
          today={today}
          activeDate={activeDate}
          selectedDate={panelOpen ? selectedDate : null}
          labelledBy={labelledBy}
          onMoveFocus={onMoveFocus}
          onActivateDay={selectDay}
          onOpenItem={onOpenItem}
          onDropItem={onDropItem}
        />
        {panelOpen && panel}
      </div>
      <CalendarLegend showHoliday={showHolidayLegend} showDragHint={!!onDropItem} />
    </div>
  );
}
