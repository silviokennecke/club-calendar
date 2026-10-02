import { useCallback, useEffect, useMemo, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Calendar, Club } from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Tabbar } from "./Tabbar";
import { SettingsTabs } from "./SettingsTabs";
import { activeNavKey } from "./navigation";
import type { ShellData } from "./shellTypes";

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
  const { pathname } = useLocation();
  const { user, logout, updateUser } = useAuth();
  const trackedRef = useRef("");

  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ["clubs"],
    queryFn: () => apiGet("/api/clubs"),
  });

  const { data: calendars = [], isLoading: calendarsLoading } = useQuery<Calendar[]>({
    // Same query as the club page: archived calendars are listed in the switcher, too.
    queryKey: ["calendars", clubId, "all"],
    queryFn: () => apiGet(`/api/clubs/${clubId}/calendars?includeArchived=true`),
  });

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

  // A club without calendars goes to setup to create one.
  useEffect(() => {
    if (calendarsLoading || calendars.length > 0) return;
    navigate(`/setup?clubId=${clubId}`, { replace: true });
  }, [calendars, calendarsLoading, navigate, clubId]);

  const onSelectClub = useCallback(
    async (newClubId: string) => {
      if (newClubId === clubId) return;
      const cals = await apiGet<Calendar[]>(`/api/clubs/${newClubId}/calendars`);
      if (cals.length > 0) navigate(`/clubs/${newClubId}/calendars/${cals[0].id}`);
      else navigate(`/setup?clubId=${newClubId}`);
    },
    [clubId, navigate],
  );

  const data: ShellData = useMemo(
    () => ({
      clubs,
      calendars,
      clubId,
      calendarId,
      userName: user?.name || user?.email || "",
      onSelectClub: (id) => void onSelectClub(id),
      onLogout: logout,
    }),
    [clubs, calendars, clubId, calendarId, user, onSelectClub, logout],
  );

  const showSettingsTabs = activeNavKey(pathname, clubId, calendarId) === "settings";

  return (
    <div className="ap ap-page">
      <a className="ap-skip cc-btn cc-btn--primary" href="#main">
        {t("shell.skipToContent")}
      </a>
      <Sidebar data={data} />
      <Topbar data={data} />
      <main className="ap-main" id="main" tabIndex={-1}>
        {showSettingsTabs && calendarId && <SettingsTabs clubId={clubId} calendarId={calendarId} />}
        <Outlet context={data} />
      </main>
      {calendarId && <Tabbar clubId={clubId} calendarId={calendarId} />}
    </div>
  );
}
