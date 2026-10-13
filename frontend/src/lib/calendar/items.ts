/**
 * Calendar items: events and holidays normalized to inclusive date ranges, plus the pure
 * layout logic for the month grid (lanes for multi-day bars, "+n more") and the day lists.
 */
import { addDays, diffDays, isValidIso, type IsoDate } from "./dates";

export type CalItemKind = "event" | "holiday";

export interface CalItem<T = unknown> {
  id: string;
  kind: CalItemKind;
  title: string;
  /** First day (inclusive). */
  start: IsoDate;
  /** Last day (inclusive); equals start for single-day items. */
  end: IsoDate;
  allDay: boolean;
  /** Wall-clock times in the event's zone ("HH:MM"), undefined for all-day items. */
  timeBegin?: string;
  timeEnd?: string;
  isDraft: boolean;
  /** Club-chosen emojis of the event's properties (content, not UI icons). */
  icons: string;
  /** Names of the properties that carry an emoji, as accessible text for `icons`. */
  iconLabel: string;
  /** Event of a series (tag "Wiederkehrend"). */
  recurring?: boolean;
  /** The original record (event or holiday). */
  source: T;
}

/** Minimal event shape (admin events and public feed events). */
export interface EventLike {
  id: string | number;
  name: string;
  date: string;
  dateEnd?: string | null;
  timeBegin: string;
  timeEnd: string;
  isAllDay?: boolean;
  isDraft?: boolean;
  seriesId?: string | null;
  properties?: { property: { name: string; icon: string | null } }[];
}

export interface HolidayLike {
  id: string | number;
  name: string;
  date: string;
  dateEnd?: string | null;
}

function shortTime(time: string | undefined): string | undefined {
  if (!time) return undefined;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : time;
}

/** Inclusive end date; an end before the start (bad data) collapses to the start. */
function endDate(start: IsoDate, end: string | null | undefined): IsoDate {
  const e = end ? end.slice(0, 10) : start;
  return isValidIso(e) && e >= start ? e : start;
}

export function eventToItem<T extends EventLike>(ev: T): CalItem<T> {
  const start = ev.date.slice(0, 10);
  const withIcons = (ev.properties ?? []).filter((p) => p.property.icon);
  const allDay = !!ev.isAllDay;
  return {
    id: String(ev.id),
    kind: "event",
    title: ev.name,
    start,
    end: endDate(start, ev.dateEnd),
    allDay,
    timeBegin: allDay ? undefined : shortTime(ev.timeBegin),
    timeEnd: allDay ? undefined : shortTime(ev.timeEnd),
    isDraft: !!ev.isDraft,
    icons: withIcons.map((p) => p.property.icon).join(""),
    iconLabel: withIcons.map((p) => p.property.name).join(", "),
    recurring: !!ev.seriesId,
    source: ev,
  };
}

export function holidayToItem<T extends HolidayLike>(h: T): CalItem<T> {
  const start = h.date.slice(0, 10);
  return {
    id: `holiday-${h.id}`,
    kind: "holiday",
    title: h.name,
    start,
    end: endDate(start, h.dateEnd),
    allDay: true,
    isDraft: false,
    icons: "",
    iconLabel: "",
    source: h,
  };
}

export function coversDay(item: Pick<CalItem, "start" | "end">, day: IsoDate): boolean {
  return item.start <= day && item.end >= day;
}

export function overlapsRange(
  item: Pick<CalItem, "start" | "end">,
  from: IsoDate,
  to: IsoDate,
): boolean {
  return item.start <= to && item.end >= from;
}

export function isMultiDay(item: Pick<CalItem, "start" | "end">): boolean {
  return item.end > item.start;
}

function kindRank(item: CalItem): number {
  return item.kind === "holiday" ? 0 : 1;
}

/**
 * Display order: holidays first, then all-day / multi-day items, then by start time and title.
 */
export function compareItems(a: CalItem, b: CalItem): number {
  if (a.kind !== b.kind) return a.kind === "holiday" ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  const spanA = diffDays(a.start, a.end);
  const spanB = diffDays(b.start, b.end);
  if (spanA !== spanB) return spanB - spanA;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const ta = a.timeBegin ?? "";
  const tb = b.timeBegin ?? "";
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/** Items on one day, sorted for display. */
export function itemsOnDay<T extends CalItem>(items: T[], day: IsoDate): T[] {
  return items.filter((i) => coversDay(i, day)).sort(compareItems);
}

/** Number of items per day (only days that have items). */
export function countByDay(items: CalItem[], days: IsoDate[]): Map<IsoDate, number> {
  const counts = new Map<IsoDate, number>();
  for (const day of days) {
    const n = items.reduce((sum, i) => sum + (coversDay(i, day) ? 1 : 0), 0);
    if (n > 0) counts.set(day, n);
  }
  return counts;
}

/** Case-insensitive name search. */
export function matchesSearch(item: Pick<CalItem, "title">, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || item.title.toLocaleLowerCase().includes(q);
}

export interface WeekSegment<T extends CalItem = CalItem> {
  item: T;
  /** First and last column (0-6) covered in this week. */
  startCol: number;
  endCol: number;
  /** 0-based lane (row below the day numbers). */
  lane: number;
  /** The item continues before / after this week. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface WeekLayout<T extends CalItem = CalItem> {
  segments: WeekSegment<T>[];
  /** Hidden items per column (0-6) that did not fit into `maxLanes`. */
  overflow: number[];
}

/**
 * Packs the items of one week into lanes (greedy, like a classic month view): each item gets
 * the lowest lane that is free for all its columns. Items that do not fit into `maxLanes`
 * are counted per column in `overflow`.
 */
export function layoutWeek<T extends CalItem>(
  items: T[],
  week: IsoDate[],
  maxLanes = 3,
): WeekLayout<T> {
  const first = week[0];
  const last = week[week.length - 1];
  const cols = week.length;
  const segs = items
    .filter((i) => overlapsRange(i, first, last))
    .sort(compareItems)
    .map((item) => {
      const s = diffDays(first, item.start);
      const e = diffDays(first, item.end);
      return {
        item,
        startCol: Math.max(0, s),
        endCol: Math.min(cols - 1, e),
        continuesBefore: s < 0,
        continuesAfter: e > cols - 1,
      };
    })
    // Holidays on top, then by first column; longer bars first within a column.
    .sort(
      (a, b) =>
        kindRank(a.item) - kindRank(b.item) ||
        a.startCol - b.startCol ||
        compareItems(a.item, b.item),
    );

  // Per-lane column occupancy: holidays are placed first regardless of their column, so a
  // lane can have free columns before an already placed bar.
  const used: boolean[][] = [];
  const isFree = (lane: number, from: number, to: number) => {
    for (let c = from; c <= to; c++) if (used[lane]?.[c]) return false;
    return true;
  };
  const overflow = new Array<number>(cols).fill(0);
  const segments: WeekSegment<T>[] = [];
  for (const seg of segs) {
    let lane = 0;
    while (lane < maxLanes && !isFree(lane, seg.startCol, seg.endCol)) lane++;
    if (lane >= maxLanes) {
      for (let c = seg.startCol; c <= seg.endCol; c++) overflow[c]++;
      continue;
    }
    used[lane] ??= new Array<boolean>(cols).fill(false);
    for (let c = seg.startCol; c <= seg.endCol; c++) used[lane][c] = true;
    segments.push({ ...seg, lane });
  }
  return { segments, overflow };
}

/**
 * New dates for an event moved to another start day; multi-day events keep their length
 * (dateEnd moves along). `dateEnd` stays null for single-day events.
 */
export function shiftEventDates(
  ev: { date: string; dateEnd?: string | null },
  newStart: IsoDate,
): { date: IsoDate; dateEnd: IsoDate | null } {
  const start = ev.date.slice(0, 10);
  if (!ev.dateEnd) return { date: newStart, dateEnd: null };
  const length = Math.max(0, diffDays(start, ev.dateEnd.slice(0, 10)));
  return { date: newStart, dateEnd: addDays(newStart, length) };
}
