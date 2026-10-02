import { useLocation, useOutletContext, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { todayIn } from "@/lib/calendar";
import type { Calendar, CalendarEvent } from "@/lib/types";
import type { ShellData } from "@/components/layout/shellTypes";
import { eventRoutes, type EventNavState } from "./routes";

/** Shared context of the event pages: ids, calendar, routes and the return target. */
export function useEventPage() {
  const { clubId = "", calendarId = "" } = useParams<{ clubId: string; calendarId: string }>();
  const shell = useOutletContext<ShellData | undefined>();
  const location = useLocation();
  const base = `/clubs/${clubId}/calendars/${calendarId}`;

  const calendarQuery = useQuery<Calendar>({
    queryKey: ["calendar", clubId, calendarId],
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
  });
  const calendar = calendarQuery.data;
  const club = shell?.clubs.find((c) => c.id === clubId);
  const timeZone = calendar?.timezone || club?.timezone || null;
  const state = (location.state as EventNavState | null) ?? {};

  return {
    clubId,
    calendarId,
    base,
    calendar,
    calendarLoading: calendarQuery.isLoading,
    isArchived: !!calendar?.archivedAt,
    timeZone,
    today: todayIn(timeZone),
    routes: eventRoutes(base),
    /** Where close / save / delete lead back to. */
    returnTo: state.from ?? base,
    /** Router state to pass on to the next step, so the return target survives. */
    navState: { from: state.from ?? base } satisfies EventNavState,
  };
}

/** All events of the calendar (list, export); invalidated with ["events", calendarId]. */
export function useAllEvents(calendarId: string) {
  return useQuery<CalendarEvent[]>({
    queryKey: ["events", calendarId, "list"],
    queryFn: () => apiGet<CalendarEvent[]>(`/api/calendars/${calendarId}/events`),
  });
}
