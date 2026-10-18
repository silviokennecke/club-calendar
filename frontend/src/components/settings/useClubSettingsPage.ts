import { useOutletContext, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { calendarBase } from "@/components/layout/navigation";
import type { ShellData } from "@/components/layout/shellTypes";
import { permissionsFor } from "@/lib/club/permissions";
import type { Calendar, Club } from "@/lib/types";
import { clubSettingsRoutes } from "./clubSettingsRoutes";

/**
 * Shared context of the club settings pages (locations, target groups, feeds): they live below
 * `/clubs/:clubId/settings` and have no calendar in the URL, so there is no archived state, only the
 * club role. Counterpart of `useSettingsPage` for the calendar settings.
 */
export function useClubSettingsPage() {
  const { clubId = "" } = useParams<{ clubId: string }>();
  const shell = useOutletContext<ShellData | undefined>();

  // Same query as the app shell (shared cache); standalone renders (tests, no shell) load it themselves.
  const clubsQuery = useQuery<Club[]>({
    queryKey: ["clubs"],
    queryFn: () => apiGet<Club[]>("/api/clubs"),
    enabled: !shell,
  });
  const calendarsQuery = useQuery<Calendar[]>({
    queryKey: ["calendars", clubId, "all"],
    queryFn: () => apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars?includeArchived=true`),
    enabled: !!clubId,
  });

  const club = (shell?.clubs ?? clubsQuery.data)?.find((c) => c.id === clubId);
  const { canEdit, isAdmin } = permissionsFor(club?.role);
  const roleLoading = !club?.role && !shell && clubsQuery.isLoading;
  const calendars = calendarsQuery.data ?? [];
  const activeCalendars = calendars.filter((c) => !c.archivedAt);
  // The calendar of the shell (current or last used), else the first active one: target of links that
  // need a calendar (export). Null while unknown or when the club has none.
  const calendarId = shell?.calendarId ?? (activeCalendars[0] ?? calendars[0])?.id ?? null;

  return {
    clubId,
    club,
    /** The club role is still loading (no write control until known). */
    roleLoading,
    /** Role editor or admin: may write locations and target groups. */
    canEdit,
    /** Role admin: manages feeds. */
    isAdmin,
    /** Role too low to write (also while the role is unknown). Club data has no archived state. */
    readOnly: !canEdit,
    /** Calendars of the club (archived ones included) and whether they are still loading. */
    calendars,
    calendarsLoading: calendarsQuery.isLoading,
    /** The non-archived calendars: the default of a new feed. */
    activeCalendars,
    /** Calendar for links that need one, or null. */
    calendarId,
    calendarHref: calendarId ? calendarBase(clubId, calendarId) : null,
    routes: clubSettingsRoutes(clubId),
  };
}
