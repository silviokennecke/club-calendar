/**
 * Event list (design: Events): status tabs, search, audience filter, month groups (pure).
 */
import { type IsoDate } from "@/lib/calendar";
import type { CalendarEvent } from "@/lib/types";
import { locationName } from "./format";

export type StatusTab = "all" | "published" | "draft";

export const STATUS_TABS: StatusTab[] = ["all", "published", "draft"];

export function parseStatusTab(value: string | null | undefined): StatusTab {
  return value === "published" || value === "draft" ? value : "all";
}

type ListEvent = Pick<CalendarEvent, "name" | "date" | "timeBegin" | "isDraft" | "isAllDay"> & {
  targetGroups: { targetGroup: { id: string } }[];
};

function matchesStatus(ev: Pick<CalendarEvent, "isDraft">, tab: StatusTab): boolean {
  if (tab === "published") return !ev.isDraft;
  if (tab === "draft") return ev.isDraft;
  return true;
}

/** Case-insensitive search in the event name. */
function matchesQuery(ev: Pick<CalendarEvent, "name">, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || ev.name.toLocaleLowerCase().includes(q);
}

/** No selection = all audiences; otherwise the event must have one of the selected groups. */
export function matchesGroups(
  ev: { targetGroups: { targetGroup: { id: string } }[] },
  groupIds: string[],
): boolean {
  return groupIds.length === 0 || ev.targetGroups.some((g) => groupIds.includes(g.targetGroup.id));
}

export interface ListFilter {
  tab: StatusTab;
  query: string;
  groupIds: string[];
}

/** Date, then all-day first, then start time, then name. */
function compareEvents(a: ListEvent, b: ListEvent): number {
  const d = a.date.slice(0, 10).localeCompare(b.date.slice(0, 10));
  if (d !== 0) return d;
  if (!!a.isAllDay !== !!b.isAllDay) return a.isAllDay ? -1 : 1;
  const t = (a.timeBegin ?? "").localeCompare(b.timeBegin ?? "");
  return t !== 0 ? t : a.name.localeCompare(b.name);
}

export type SortKey = "name" | "date" | "place" | "status";
export type SortDir = "asc" | "desc";
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export const SORTABLE_KEYS: SortKey[] = ["name", "date", "place", "status"];
export const DEFAULT_SORT: SortState = { key: "date", dir: "asc" };

/** URL value: "name" = ascending, "-name" = descending; anything unknown = default (date ascending). */
export function parseSort(value: string | null | undefined): SortState {
  const desc = !!value?.startsWith("-");
  const key = (desc ? value!.slice(1) : (value ?? "")) as SortKey;
  return SORTABLE_KEYS.includes(key) ? { key, dir: desc ? "desc" : "asc" } : DEFAULT_SORT;
}

/** Inverse of parseSort; the default state has no URL value. */
export function serializeSort(sort: SortState): string {
  if (sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir) return "";
  return `${sort.dir === "desc" ? "-" : ""}${sort.key}`;
}

/** Click cycle of a column header: ascending, descending, back to the default. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : DEFAULT_SORT;
}

type SortableEvent = ListEvent & {
  location?: Parameters<typeof locationName>[0] | null;
};

/**
 * Sorts a copy by the chosen column. Ties keep the default order (date, all-day, start, name);
 * text compares locale-aware, events without a place come last in both directions.
 */
export function sortEvents<T extends SortableEvent>(
  events: T[],
  sort: SortState,
  locale: string,
): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const sign = sort.dir === "desc" ? -1 : 1;
  const cmp = (a: T, b: T): number => {
    switch (sort.key) {
      case "name":
        return sign * collator.compare(a.name, b.name);
      case "date":
        return sign * compareEvents(a, b);
      case "status":
        return sign * (Number(a.isDraft) - Number(b.isDraft));
      case "place": {
        const pa = a.location ? locationName(a.location) : "";
        const pb = b.location ? locationName(b.location) : "";
        if (!pa || !pb) return pa === pb ? 0 : pa ? -1 : 1;
        return sign * collator.compare(pa, pb);
      }
    }
  };
  return [...events].sort((a, b) => cmp(a, b) || compareEvents(a, b));
}

export function filterEvents<T extends ListEvent>(events: T[], filter: ListFilter): T[] {
  return events
    .filter(
      (ev) =>
        matchesStatus(ev, filter.tab) &&
        matchesQuery(ev, filter.query) &&
        matchesGroups(ev, filter.groupIds),
    )
    .sort(compareEvents);
}

/**
 * Counts per tab. Search and audience filter apply, so the numbers always match what the
 * tab will show.
 */
export function countByStatus<T extends ListEvent>(
  events: T[],
  filter: Omit<ListFilter, "tab">,
): Record<StatusTab, number> {
  const base = events.filter(
    (ev) => matchesQuery(ev, filter.query) && matchesGroups(ev, filter.groupIds),
  );
  return {
    all: base.length,
    published: base.filter((e) => !e.isDraft).length,
    draft: base.filter((e) => e.isDraft).length,
  };
}

export interface MonthGroup<T> {
  /** "YYYY-MM". */
  key: string;
  /** First day of the month, for labels. */
  month: IsoDate;
  events: T[];
}

/** Groups sorted events by the month of their start date (order kept). */
export function groupByMonth<T extends Pick<CalendarEvent, "date">>(events: T[]): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = [];
  for (const ev of events) {
    const key = ev.date.slice(0, 7);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, month: `${key}-01`, events: [] };
      groups.push(group);
    }
    group.events.push(ev);
  }
  return groups;
}

/** Which kind of empty state the list shows (design: EventsStates). */
export type ListEmptyKind =
  "none" | "noCalendarEvents" | "noSearchHits" | "noPublished" | "noDrafts" | "noFilterHits";

export function emptyKind(totalEvents: number, shown: number, filter: ListFilter): ListEmptyKind {
  if (shown > 0) return "none";
  if (totalEvents === 0) return "noCalendarEvents";
  if (filter.query.trim()) return "noSearchHits";
  if (filter.groupIds.length > 0) return "noFilterHits";
  if (filter.tab === "published") return "noPublished";
  if (filter.tab === "draft") return "noDrafts";
  return "noFilterHits";
}

export interface SelectionSummary {
  count: number;
  drafts: number;
  published: number;
}

export function summarizeSelection(events: Pick<CalendarEvent, "isDraft">[]): SelectionSummary {
  const drafts = events.filter((e) => e.isDraft).length;
  return { count: events.length, drafts, published: events.length - drafts };
}
