/**
 * View state helpers: visible ranges, navigation steps and grid keyboard moves.
 */
import {
  addDays,
  addMonthsClamped,
  isValidIso,
  monthGridRange,
  startOfWeek,
  yearMonthOf,
  type IsoDate,
  type WeekStart,
} from "./dates";

export type CalendarView = "month" | "week";

export function parseView(value: string | null | undefined): CalendarView {
  return value === "week" ? "week" : "month";
}

/** The anchor date from the URL, or `fallback` (usually today) when missing or invalid. */
export function parseAnchor(value: string | null | undefined, fallback: IsoDate): IsoDate {
  return isValidIso(value) ? value.slice(0, 10) : fallback;
}

/** First and last visible day (inclusive). */
export function visibleRange(
  view: CalendarView,
  anchor: IsoDate,
  weekStart: WeekStart = 1,
): [IsoDate, IsoDate] {
  if (view === "week") {
    const start = startOfWeek(anchor, weekStart);
    return [start, addDays(start, 6)];
  }
  return monthGridRange(yearMonthOf(anchor), weekStart);
}

/**
 * The events API filters by start date only, so multi-day events that started before the
 * visible range would be missing. Fetch this many days earlier and filter by overlap locally.
 */
export const MULTI_DAY_LOOKBACK_DAYS = 31;

export function fetchRange(
  view: CalendarView,
  anchor: IsoDate,
  weekStart: WeekStart = 1,
): [IsoDate, IsoDate] {
  const [from, to] = visibleRange(view, anchor, weekStart);
  return [addDays(from, -MULTI_DAY_LOOKBACK_DAYS), to];
}

/** Anchor after "previous" (-1) / "next" (+1). */
export function stepAnchor(view: CalendarView, anchor: IsoDate, direction: -1 | 1): IsoDate {
  return view === "week" ? addDays(anchor, 7 * direction) : addMonthsClamped(anchor, direction);
}

/**
 * Target date for a key press in a date grid (roving tabindex), or null if the key is not a
 * grid key. Arrows move by day/week, Home/End to the start/end of the week, PageUp/PageDown
 * by month (Shift: by year).
 */
export function gridKeyTarget(
  date: IsoDate,
  key: string,
  weekStart: WeekStart = 1,
  shiftKey = false,
): IsoDate | null {
  switch (key) {
    case "ArrowLeft":
      return addDays(date, -1);
    case "ArrowRight":
      return addDays(date, 1);
    case "ArrowUp":
      return addDays(date, -7);
    case "ArrowDown":
      return addDays(date, 7);
    case "Home":
      return startOfWeek(date, weekStart);
    case "End":
      return addDays(startOfWeek(date, weekStart), 6);
    case "PageUp":
      return addMonthsClamped(date, shiftKey ? -12 : -1);
    case "PageDown":
      return addMonthsClamped(date, shiftKey ? 12 : 1);
    default:
      return null;
  }
}
