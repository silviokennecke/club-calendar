import { Navigate, useLocation, useParams } from "react-router-dom";

const TABS = ["general", "calendars", "members"];

/** `/clubs/:clubId` (and the old `?tab=` addresses) -> `/clubs/:clubId/<tab>`, default tab general. */
export function LegacyClubTabRedirect() {
  const { clubId = "" } = useParams<{ clubId: string }>();
  const { search, hash, state } = useLocation();
  const params = new URLSearchParams(search);
  const requested = params.get("tab") ?? "";
  const tab = TABS.includes(requested) ? requested : "general";
  params.delete("tab");
  const rest = params.toString();
  return (
    <Navigate
      to={{ pathname: `/clubs/${clubId}/${tab}`, search: rest ? `?${rest}` : "", hash }}
      state={state}
      replace
    />
  );
}
