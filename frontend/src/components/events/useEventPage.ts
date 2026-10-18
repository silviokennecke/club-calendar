import { useOutletContext, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { todayIn } from "@/lib/calendar";
import type { Calendar, CalendarEvent, Club } from "@/lib/types";
import type { ShellData } from "@/components/layout/shellTypes";
import { permissionsFor } from "@/lib/club/permissions";
import { eventRoutes } from "./routes";

/**
 * Shared context of the calendar pages and the event dialogs: ids, calendar, routes. The routed
 * event dialogs render outside the app shell's outlet, they read the clubs from the query cache.
 */
export function useEventPage() {
  const { clubId = "", calendarId = "" } = useParams<{ clubId: string; calendarId: string }>();
  const shell = useOutletContext<ShellData | undefined>();
  const base = `/clubs/${clubId}/calendars/${calendarId}`;

  const calendarQuery = useQuery<Calendar>({
    queryKey: ["calendar", clubId, calendarId],
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
  });
  // Same query as the app shell (shared cache).
  const clubsQuery = useQuery<Club[]>({
    queryKey: ["clubs"],
    queryFn: () => apiGet<Club[]>("/api/clubs"),
    enabled: !shell,
  });
  const calendar = calendarQuery.data;
  const club = (shell?.clubs ?? clubsQuery.data)?.find((c) => c.id === clubId);
  const timeZone = calendar?.timezone || club?.timezone || null;
  // Club role (viewer < editor < admin): unknown until the club list is loaded, then no write control.
  const { canEdit: roleCanEdit, isAdmin } = permissionsFor(club?.role);
  const roleLoading = !club?.role && !shell && clubsQuery.isLoading;

  return {
    clubId,
    calendarId,
    base,
    calendar,
    calendarLoading: calendarQuery.isLoading,
    /** The calendar could not be loaded (and nothing is cached). */
    calendarFailed: calendarQuery.isError && !calendar,
    reloadCalendar: () => void calendarQuery.refetch(),
    isArchived: !!calendar?.archivedAt,
    /** The club role is still loading (no write control until known). */
    roleLoading,
    /** Role editor or admin: may write events, templates and reference data. */
    roleCanEdit,
    /** Role admin: manages calendars and feeds. */
    isAdmin,
    /** Role editor or admin and the calendar is loaded and not archived: events etc. can be changed. */
    canEdit: roleCanEdit && !!calendar && !calendar.archivedAt,
    /** Opposite of `canEdit` for loaded calendars (archived or role too low). */
    readOnly: !roleCanEdit || !!calendar?.archivedAt,
    timeZone,
    today: todayIn(timeZone),
    routes: eventRoutes(base),
  };
}

/** All events of the calendar (list, export); invalidated with ["events", calendarId]. */
export function useAllEvents(calendarId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<CalendarEvent[]>({
    queryKey: ["events", calendarId, "list"],
    queryFn: () => apiGet<CalendarEvent[]>(`/api/calendars/${calendarId}/events`),
    enabled,
  });
}
