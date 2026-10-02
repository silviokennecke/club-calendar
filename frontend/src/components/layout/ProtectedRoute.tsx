import { useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { FullPageLoader } from "@/components/ui/shared";
import { AppShell } from "./AppShell";

function parseContextFromPath(
  pathname: string,
): { clubId: string; calendarId: string | null } | null {
  const withCalendar = pathname.match(/^\/clubs\/([^/]+)\/calendars\/([^/]+)/);
  if (withCalendar) return { clubId: withCalendar[1], calendarId: withCalendar[2] };
  const clubOnly = pathname.match(/^\/clubs\/([^/]+)\/?$/);
  if (clubOnly) return { clubId: clubOnly[1], calendarId: null };
  return null;
}

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) return <FullPageLoader />;

  if (pathname === "/setup") return <Outlet />;

  const fromUrl = parseContextFromPath(pathname);
  const lastClubId = user.lastClubId ? String(user.lastClubId) : null;
  const lastCalendarId = user.lastCalendarId ? String(user.lastCalendarId) : null;

  const clubId = fromUrl?.clubId ?? lastClubId;
  let calendarId = fromUrl?.calendarId ?? null;
  if (!calendarId && clubId && clubId === lastClubId) calendarId = lastCalendarId;

  if (clubId) {
    return (
      <AppShell
        key={clubId}
        clubId={clubId}
        calendarId={calendarId}
        trackLastUsed={!!fromUrl?.calendarId}
      />
    );
  }

  return <Outlet />;
}
