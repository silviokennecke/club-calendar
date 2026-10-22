import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { stashReturnTo } from "@/lib/mcp";
import { FullPageLoader } from "@/components/ui/shared";
import { ConsentPage } from "@/pages/lazy";
import { ConsentChangeBanner } from "@/components/legal/ConsentChangeBanner";
import { AppShell } from "./AppShell";

function parseContextFromPath(
  pathname: string,
): { clubId: string; calendarId: string | null } | null {
  const withCalendar = pathname.match(/^\/clubs\/([^/]+)\/calendars\/([^/]+)/);
  if (withCalendar) return { clubId: withCalendar[1], calendarId: withCalendar[2] };
  // Club page and club settings (locations, target groups, feeds): no calendar in the URL.
  const clubOnly = pathname.match(/^\/clubs\/([^/]+)(?:\/settings(?:\/.*)?)?\/?$/);
  if (clubOnly) return { clubId: clubOnly[1], calendarId: null };
  return null;
}

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  // The club of the last club or calendar URL: pages without a club in the URL (profile) keep the
  // app shell even while the "last used club" of the user is still being saved.
  const [visitedClubId, setVisitedClubId] = useState<string | null>(null);
  const urlClubId = parseContextFromPath(pathname)?.clubId ?? null;
  if (urlClubId && urlClubId !== visitedClubId) setVisitedClubId(urlClubId);

  useEffect(() => {
    if (loading || user) return;
    // The consent page of an OAuth client: /clubs forwards back to it after the sign-in.
    if (pathname === "/oauth/consent") stashReturnTo(pathname + search);
    navigate("/login", { replace: true });
  }, [user, loading, navigate, pathname, search]);

  if (loading || !user) return <FullPageLoader />;

  // Consent gate: pending legal documents lock the app (the API answers 403 `consent_required` anyway).
  if (user.consentRequired) return <ConsentPage />;

  // Club picker and onboarding are standalone pages (no sidebar), even for users with a last club.
  if (pathname === "/setup" || pathname === "/clubs" || pathname === "/oauth/consent") {
    // Leaving a club (picker, deleted or left club): do not carry it over to the profile page.
    if (visitedClubId) setVisitedClubId(null);
    return (
      <>
        <StandaloneBanner />
        <Outlet />
      </>
    );
  }

  const fromUrl = parseContextFromPath(pathname);
  const lastClubId = user.lastClubId ? String(user.lastClubId) : null;
  const lastCalendarId = user.lastCalendarId ? String(user.lastCalendarId) : null;

  const clubId = fromUrl?.clubId ?? lastClubId ?? visitedClubId;
  let calendarId = fromUrl?.calendarId ?? null;
  if (!calendarId && clubId && clubId === lastClubId) calendarId = lastCalendarId;

  if (clubId) {
    return (
      <AppShell
        key={clubId}
        clubId={clubId}
        calendarId={calendarId}
        trackLastUsed={!!fromUrl?.calendarId}
        banner={<ConsentChangeBanner />}
      />
    );
  }

  return (
    <>
      <StandaloneBanner />
      <Outlet />
    </>
  );
}

/** Banner above pages without the app shell (club picker, onboarding). */
function StandaloneBanner() {
  return (
    <div className="ap">
      <ConsentChangeBanner standalone />
    </div>
  );
}
