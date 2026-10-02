import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet, getHolidayEvents } from "@/lib/api";
import type { CalendarEvent, HolidayEvent } from "@/lib/types";
import {
  eventToItem,
  fetchRange,
  holidayToItem,
  overlapsRange,
  visibleRange,
  type CalItem,
  type CalendarView,
  type IsoDate,
  type WeekStart,
} from "@/lib/calendar";

interface Options {
  calendarId: string;
  view: CalendarView;
  anchor: IsoDate;
  weekStart: WeekStart;
  /** Server-side target group filter. */
  targetGroupIds: string[];
  /** Only check whether the calendar has any event at all when the visible range is empty. */
  checkEmpty: boolean;
}

/**
 * Loads the events (incl. multi-day events that started earlier) and holidays of the visible
 * range. Previous data stays visible while the next range loads.
 */
export function useCalendarData({
  calendarId,
  view,
  anchor,
  weekStart,
  targetGroupIds,
  checkEmpty,
}: Options) {
  const [from, to] = visibleRange(view, anchor, weekStart);
  const [fetchFrom] = fetchRange(view, anchor, weekStart);
  const tg = [...targetGroupIds].sort().join(",");

  const eventsQuery = useQuery<CalendarEvent[]>({
    queryKey: ["events", calendarId, fetchFrom, to, tg],
    queryFn: () =>
      apiGet<CalendarEvent[]>(
        `/api/calendars/${calendarId}/events?from=${fetchFrom}&to=${to}${tg ? `&targetGroupIds=${tg}` : ""}`,
      ),
    placeholderData: keepPreviousData,
  });

  const holidaysQuery = useQuery<HolidayEvent[]>({
    queryKey: ["holidayEvents", calendarId, from, to],
    queryFn: () => getHolidayEvents(calendarId, from, to),
    placeholderData: keepPreviousData,
  });

  const eventItems = useMemo<CalItem<CalendarEvent>[]>(
    () =>
      (eventsQuery.data ?? [])
        .map((ev) => eventToItem(ev))
        .filter((i) => overlapsRange(i, from, to)),
    [eventsQuery.data, from, to],
  );
  const holidayItems = useMemo<CalItem<HolidayEvent>[]>(
    () =>
      (holidaysQuery.data ?? [])
        .map((h) => holidayToItem(h))
        .filter((i) => overlapsRange(i, from, to)),
    [holidaysQuery.data, from, to],
  );

  const rangeEmpty =
    eventsQuery.isSuccess && !eventsQuery.isPlaceholderData && eventItems.length === 0;
  // The API has no count endpoint: only when nothing is visible, ask for any event at all.
  const anyQuery = useQuery<CalendarEvent[]>({
    queryKey: ["events", calendarId, "any"],
    queryFn: () => apiGet<CalendarEvent[]>(`/api/calendars/${calendarId}/events`),
    enabled: checkEmpty && rangeEmpty && targetGroupIds.length === 0,
  });

  return {
    from,
    to,
    eventItems,
    holidayItems,
    isLoading: eventsQuery.isPending,
    isError: eventsQuery.isError,
    hasData: eventsQuery.data !== undefined,
    refetch: () => {
      void eventsQuery.refetch();
      void holidaysQuery.refetch();
    },
    calendarEmpty: rangeEmpty && anyQuery.isSuccess && anyQuery.data.length === 0,
  };
}
