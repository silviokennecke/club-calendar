import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "@/lib/api";
import { pickCalendar } from "@/lib/pickCalendar";
import { readLastCalendar, rememberLastCalendar } from "@/lib/lastCalendar";
import { useAuth } from "@/lib/auth-context";
import type { Calendar, Club } from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Tabbar } from "./Tabbar";
import type { ShellData } from "./shellTypes";
import { FullPageLoader } from "@/components/ui/shared";

interface AppShellProps {
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
  clubId,
  calendarId: requestedCalendarId,
  trackLastUsed,
}: AppShellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout, updateUser } = useAuth();
  const trackedRef = useRef("");

  const { data: clubsData, isLoading: clubsLoading } = useQuery<Club[]>({
    queryKey: ["clubs"],
    queryFn: () => apiGet("/api/clubs"),
  });

  const clubs = useMemo(() => clubsData ?? [], [clubsData]);
  const {
    data: calendarsData,
    isLoading: calendarsLoading,
    isError: calendarsFailed,
  } = useQuery<Calendar[]>({
    // Same query as the club page: archived calendars are listed in the switcher, too.
    queryKey: ["calendars", clubId, "all"],
    queryFn: () => apiGet(`/api/clubs/${clubId}/calendars?includeArchived=true`),
  });

  const calendars = useMemo(() => calendarsData ?? [], [calendarsData]);
  // A club that is not in the user's list (foreign / deleted) or whose calendars cannot be loaded.
  const contextState: ShellData["contextState"] =
    calendarsFailed || (!!clubsData && !clubs.some((c) => c.id === clubId))
      ? "unavailable"
      : clubsLoading || calendarsLoading
        ? "loading"
        : "ready";

  const calendarId =
    requestedCalendarId && (calendarsLoading || calendars.some((c) => c.id === requestedCalendarId))
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

  // Remember the calendar per club in this browser (club switches reopen it). Only one that exists in
  // this club counts, so a stale id in the URL is never stored.
  useEffect(() => {
    if (!trackLastUsed || !calendarId || !calendars.some((c) => c.id === calendarId)) return;
    rememberLastCalendar(user?.id, clubId, calendarId);
  }, [user?.id, clubId, calendarId, calendars, trackLastUsed]);

  // A club without calendars goes to setup to create one (not when loading them failed).
  useEffect(() => {
    if (calendarsLoading || calendarsFailed || calendars.length > 0) return;
    navigate(`/setup?clubId=${clubId}`, { replace: true });
  }, [calendars, calendarsLoading, calendarsFailed, navigate, clubId]);

  const onSelectClub = useCallback(
    async (newClubId: string) => {
      if (newClubId === clubId) return;
      const cals = await apiGet<Calendar[]>(`/api/clubs/${newClubId}/calendars`);
      // The calendar last used in that club, not simply the first one.
      const target = pickCalendar(
        cals,
        newClubId,
        user?.lastClubId ? String(user.lastClubId) : null,
        user?.lastCalendarId ? String(user.lastCalendarId) : null,
        readLastCalendar(user?.id, newClubId),
      );
      if (target) navigate(`/clubs/${newClubId}/calendars/${target.id}`);
      else navigate(`/setup?clubId=${newClubId}`);
    },
    [clubId, navigate, user?.id, user?.lastClubId, user?.lastCalendarId],
  );

  const data: ShellData = useMemo(
    () => ({
      clubs,
      calendars,
      clubId,
      calendarId,
      contextState,
      userName: user?.name || user?.email || "",
      onSelectClub: (id) => void onSelectClub(id),
      onLogout: logout,
    }),
    [clubs, calendars, clubId, calendarId, contextState, user, onSelectClub, logout],
  );

  return (
    <div className="ap ap-page">
      <a className="ap-skip cc-btn cc-btn--primary" href="#main">
        {t("shell.skipToContent")}
      </a>
      <Sidebar data={data} />
      <Topbar data={data} />
      <main className="ap-main" id="main" tabIndex={-1}>
        {/* First load of a lazy page: keep the shell, show the loading state in the content area. */}
        <Suspense fallback={<FullPageLoader className="min-h-[50vh]" />}>
          <Outlet context={data} />
        </Suspense>
      </main>
      {calendarId && <Tabbar clubId={clubId} calendarId={calendarId} />}
    </div>
  );
}
