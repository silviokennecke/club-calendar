import { Navigate, useLocation } from "react-router-dom";

/**
 * Old calendar-level addresses of the club data screens (`/clubs/:clubId/calendars/:calendarId/settings/`
 * locations, target-groups, feeds, feeds/new, feeds/:feedId) -> `/clubs/:clubId/settings/…`; query, hash
 * and router state are kept.
 */
export function LegacyClubSettingsRedirect() {
  const { pathname, search, hash, state } = useLocation();
  const to = pathname.replace(/\/calendars\/[^/]+\/settings\//, "/settings/");
  return <Navigate to={{ pathname: to, search, hash }} state={state} replace />;
}
