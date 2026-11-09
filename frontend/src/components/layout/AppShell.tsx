import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "@/lib/api";
import { pickCalendar } from "@/lib/pickCalendar";
import { useAuth } from "@/lib/auth-context";
import { isPlainMember } from "@/lib/club/permissions";
import { memberMayOpen, myClubPath } from "@/lib/club/myClub";
import type { Calendar, Club } from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Tabbar } from "./Tabbar";
import type { ShellData } from "./shellTypes";
import { FullPageLoader } from "@/components/ui/shared";

interface AppShellProps {
  /** Shown at the top of the content area (e.g. the consent-change banner). */
  banner?: ReactNode;
  clubId: string;
  /** Calendar from the URL or the user's last one; falls back to the club's first calendar. */
  calendarId: string | null;
  /** Remember club/calendar as "last used" on the user (only for calendar routes). */
  trackLastUsed?: boolean;
}

/**
 * Authenticated app frame: skip link, desktop sidebar, mobile top bar + tab bar, <main>.
 * Child routes get the ShellData via useOutletContext().
 */
export function AppShell({
  banner,
  clubId,
  calendarId: requestedCalendarId,
  trackLastUsed,
}: AppShellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const trackedRef = useRef("");

  const { data: clubsData, isLoading: clubsLoading } = useQuery<Club[]>({
    queryKey: ["clubs"],
    queryFn: () => apiGet("/api/clubs"),
  });

  const clubs = useMemo(() => clubsData ?? [], [clubsData]);
  const { pathname } = useLocation();
  const role = clubs.find((c) => c.id === clubId)?.role;
  // A plain member has no access to calendars and settings: nothing of that is requested or shown.
  const isMember = isPlainMember(role);
  const {
    data: calendarsData,
    isLoading: calendarsLoading,
    isError: calendarsFailed,
  } = useQuery<Calendar[]>({
    // Same query as the club page: archived calendars are listed in the switcher, too.
    queryKey: ["calendars", clubId, "all"],
    queryFn: () => apiGet(`/api/clubs/${clubId}/calendars?includeArchived=true`),
    // The role comes with the club list; until then nothing is requested that a member may not read.
    enabled: !clubsLoading && !isMember,
  });

  const calendars = useMemo(() => calendarsData ?? [], [calendarsData]);
  const calendarsPending = !isMember && (clubsLoading || calendarsLoading);
  // A club that is not in the user's list (foreign / deleted) or whose calendars cannot be loaded.
  const contextState: ShellData["contextState"] =
    calendarsFailed || (!!clubsData && !clubs.some((c) => c.id === clubId))
      ? "unavailable"
      : clubsLoading || calendarsPending
        ? "loading"
        : "ready";

  const calendarId = isMember
    ? null
    : requestedCalendarId &&
        (calendarsPending || calendars.some((c) => c.id === requestedCalendarId))
      ? requestedCalendarId
      : ((calendars.find((c) => !c.archivedAt) ?? calendars[0])?.id ?? null);

  // Remember the last used club/calendar (only when the pair changes).
  useEffect(() => {
    if (!trackLastUsed || !calendarId) return;
    const key = `${clubId}-${calendarId}`;
    if (trackedRef.current === key) return;
    trackedRef.current = key;
    void updateUser({ lastClubId: clubId, lastCalendarId: calendarId });
  }, [clubId, calendarId, trackLastUsed]); // eslint-disable-line react-hooks/exhaustive-deps

  // The PATCH above also stores the calendar at the membership (`lastCalendarId` of `GET /api/clubs`,
  // across devices). Mirror it in the cached club list, so a club switch in this tab reopens it. Only a
  // calendar of this club counts (the backend ignores others as well).
  useEffect(() => {
    if (!trackLastUsed || !calendarId || !calendars.some((c) => c.id === calendarId)) return;
    queryClient.setQueryData<Club[]>(["clubs"], (old) =>
      old?.map((c) => (c.id === clubId ? { ...c, lastCalendarId: calendarId } : c)),
    );
  }, [queryClient, clubId, calendarId, calendars, trackLastUsed]);

  // A club without calendars goes to setup to create one (not when loading them failed).
  useEffect(() => {
    if (isMember || calendarsPending || calendarsFailed || calendars.length > 0) return;
    navigate(`/setup?clubId=${clubId}`, { replace: true });
  }, [isMember, calendars, calendarsPending, calendarsFailed, navigate, clubId]);

  // A plain member reopens their club at "Mein Verein" (there is no calendar to remember).
  useEffect(() => {
    if (!isMember || trackedRef.current === clubId || String(user?.lastClubId) === clubId) return;
    trackedRef.current = clubId;
    void updateUser({ lastClubId: clubId, lastCalendarId: null });
  }, [isMember, clubId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelectClub = useCallback(
    async (newClubId: string) => {
      if (newClubId === clubId) return;
      if (isPlainMember(clubs.find((c) => c.id === newClubId)?.role)) {
        navigate(myClubPath(newClubId));
        return;
      }
      const cals = await apiGet<Calendar[]>(`/api/clubs/${newClubId}/calendars`);
      // The calendar last used in that club (stored at the membership), not simply the first one.
      const target = pickCalendar(
        cals,
        newClubId,
        user?.lastClubId ? String(user.lastClubId) : null,
        user?.lastCalendarId ? String(user.lastCalendarId) : null,
        clubs.find((c) => c.id === newClubId)?.lastCalendarId ?? null,
      );
      if (target) navigate(`/clubs/${newClubId}/calendars/${target.id}`);
      else navigate(`/setup?clubId=${newClubId}`);
    },
    [clubId, clubs, navigate, user?.lastClubId, user?.lastCalendarId],
  );

  const data: ShellData = useMemo(
    () => ({
      clubs,
      calendars,
      clubId,
      calendarId,
      contextState,
      role,
      userName: user?.name || user?.email || "",
      onSelectClub: (id) => void onSelectClub(id),
      onLogout: logout,
    }),
    [clubs, calendars, clubId, calendarId, contextState, role, user, onSelectClub, logout],
  );

  // A plain member only gets Mein Verein and the profile; everything else goes back to Mein Verein.
  const redirectMember = isMember && !memberMayOpen(pathname, clubId);
  // The role is unknown until the club list is loaded: do not start pages that would get a 403.
  const roleUnknown = clubsLoading && !memberMayOpen(pathname, clubId);

  return (
    <div className="ap ap-page">
      <a className="ap-skip cc-btn cc-btn--primary" href="#main">
        {t("shell.skipToContent")}
      </a>
      <Sidebar data={data} />
      <Topbar data={data} />
      <main className="ap-main" id="main" tabIndex={-1}>
        {banner}
        {/* First load of a lazy page: keep the shell, show the loading state in the content area. */}
        <Suspense fallback={<FullPageLoader className="min-h-[50vh]" />}>
          {/* Keyed: switching the calendar on the same route resets page-local state. */}
          <Fragment key={calendarId ?? ""}>
            {redirectMember ? (
              <Navigate to={myClubPath(clubId)} replace />
            ) : roleUnknown ? (
              <FullPageLoader className="min-h-[50vh]" />
            ) : (
              <Outlet context={data} />
            )}
          </Fragment>
        </Suspense>
      </main>
      {(calendarId || isMember) && <Tabbar clubId={clubId} calendarId={calendarId} role={role} />}
    </div>
  );
}
