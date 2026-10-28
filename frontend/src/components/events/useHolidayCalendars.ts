import { useQuery } from "@tanstack/react-query";
import { getHolidayCalendars } from "@/lib/api";
import type { HolidayCalendar } from "@/lib/types";

/** The holiday calendars of a calendar (same cache entry as the settings page). */
export function useHolidayCalendars(calendarId: string) {
  return useQuery<HolidayCalendar[]>({
    queryKey: ["holidayCalendars", calendarId],
    queryFn: () => getHolidayCalendars(calendarId),
    enabled: !!calendarId,
  });
}
