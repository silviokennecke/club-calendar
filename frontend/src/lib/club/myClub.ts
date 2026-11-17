// "Mein Verein": the club area every member (any role) can use; for a plain member it is the only one.
export const MY_CLUB_TABS = ["calendar", "subscription"] as const;
export type MyClubTab = (typeof MY_CLUB_TABS)[number];

export function myClubPath(clubId: string, tab?: MyClubTab): string {
  const base = `/clubs/${clubId}/me`;
  return tab && tab !== "calendar" ? `${base}?tab=${tab}` : base;
}

export function parseMyClubTab(value: string | null): MyClubTab {
  return MY_CLUB_TABS.find((tab) => tab === value) ?? "calendar";
}

export function isMyClubPath(pathname: string, clubId: string): boolean {
  const path = pathname.replace(/\/+$/, "");
  return path === `/clubs/${clubId}/me`;
}

function isMyEventPath(path: string, clubId: string): boolean {
  const prefix = `/clubs/${clubId}/me/events/`;
  return (
    path.startsWith(prefix) &&
    path.length > prefix.length &&
    !path.slice(prefix.length).includes("/")
  );
}

// Calendar settings a member may read; the club-wide legacy addresses and the permission tab stay closed.
const MEMBER_SETTINGS = new Set(["properties", "features", "holiday-calendars"]);

/** A calendar route of a calendar the member holds a permission for (one of `calendarIds`). */
function isMemberCalendarPath(
  path: string,
  clubId: string,
  calendarIds: readonly string[],
): boolean {
  const prefix = `/clubs/${clubId}/calendars/`;
  if (!path.startsWith(prefix)) return false;
  const [id, ...rest] = path.slice(prefix.length).split("/");
  if (!id || !calendarIds.includes(id)) return false;
  if (rest[0] === "settings" && rest.length > 1)
    return rest.length === 2 && MEMBER_SETTINGS.has(rest[1]);
  return true;
}

/**
 * Pages a plain member may open inside the shell: Mein Verein, the own profile and the calendar pages of
 * the calendars they hold a permission for (`calendarIds`).
 */
export function memberMayOpen(
  pathname: string,
  clubId: string,
  calendarIds: readonly string[] = [],
): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (isMemberCalendarPath(path, clubId, calendarIds)) return true;
  // The event dialog above Mein Verein has its own address (/clubs/:id/me/events/:eventId).
  return (
    path === "/profile" ||
    path.startsWith("/profile/") ||
    isMyClubPath(path, clubId) ||
    isMyEventPath(path, clubId)
  );
}
