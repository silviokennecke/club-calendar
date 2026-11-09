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

/** Pages a plain member may open inside the shell: Mein Verein and the own profile. */
export function memberMayOpen(pathname: string, clubId: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/profile" || isMyClubPath(path, clubId);
}
