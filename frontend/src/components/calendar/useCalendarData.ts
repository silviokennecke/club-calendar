import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet, getHolidayEvents } from "@/lib/api";
import type { Calendar, CalendarEvent, HolidayEvent } from "@/lib/types";
import {
  eventToItem,
  holidayToItem,
  overlapsRange,
  visibleRange,
  type CalItem,
  type CalendarView,
  type IsoDate,
  type WeekStart,
} from "@/lib/calendar";

interface Options {
  clubId: string;
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
 * Loads the events and holidays of the visible range (the API includes multi-day entries that
 * overlap it). Previous data stays visible while the next range loads.
 */
export function useCalendarData({
  clubId,
  calendarId,
  view,
  anchor,
  weekStart,
  targetGroupIds,
  checkEmpty,
}: Options) {
  // The events and holiday endpoints filter by overlap, so multi-day entries that started before the
  // visible range are included without fetching earlier days.
  const [from, to] = visibleRange(view, anchor, weekStart);
  const tg = [...targetGroupIds].sort().join(",");

  const eventsQuery = useQuery<CalendarEvent[]>({
    queryKey: ["events", calendarId, from, to, tg],
    queryFn: () =>
      apiGet<CalendarEvent[]>(
        `/api/calendars/${calendarId}/events?from=${from}&to=${to}${tg ? `&targetGroupIds=${tg}` : ""}`,
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
  // Only when nothing is visible: does the calendar have any event at all? (`eventCount` of the
  // calendar; the key lies below ["events", calendarId], so saving an event refreshes it.)
  const countQuery = useQuery<Calendar>({
    queryKey: ["events", calendarId, "count"],
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
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
    calendarEmpty: rangeEmpty && countQuery.isSuccess && countQuery.data.eventCount === 0,
  };
}
