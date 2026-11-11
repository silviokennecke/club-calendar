import type { Glyph } from "@/components/ui/shared";
import { isPlainMember, roleAtLeast } from "@/lib/club/permissions";
import { myClubPath } from "@/lib/club/myClub";
import type { ClubRole } from "@/lib/types";
import { clubSettingsRoutes } from "@/components/settings/clubSettingsRoutes";

/** Areas of the app shell (design: Sidebar.dc.html "active"). */
export type NavKey =
  | "calendar"
  | "events"
  | "templates"
  | "settings"
  | "feeds"
  | "clubSettings"
  | "club"
  | "me"
  | "profile"
  | "more";

export type TabKey = "calendar" | "events" | "feeds" | "me" | "more";

export interface NavItem {
  key: NavKey;
  /** i18n key of the label. */
  labelKey: string;
  href: string;
  icon: Glyph;
}

export interface NavGroup {
  /** i18n key of the group title. */
  titleKey: string;
  items: NavItem[];
}

export interface TabItem {
  key: TabKey;
  labelKey: string;
  href: string;
  icon: Glyph;
}

export function calendarBase(clubId: string, calendarId: string) {
  return `/clubs/${clubId}/calendars/${calendarId}`;
}

/** Sidebar navigation mapped onto the existing routes. */
export function buildNavGroups(
  clubId: string,
  calendarId: string | null,
  /** Role of the signed-in user: viewers (and an unknown role) get no import and no feeds; a member only "Mein Verein". */
  role?: ClubRole,
): NavGroup[] {
  const myClub: NavItem = {
    key: "me",
    labelKey: "shell.nav.myClub",
    href: myClubPath(clubId),
    icon: "user",
  };
  if (isPlainMember(role) || !calendarId) {
    return [{ titleKey: "shell.groups.club", items: [myClub] }];
  }
  const base = calendarBase(clubId, calendarId);
  const clubSettings = clubSettingsRoutes(clubId);
  const canEdit = roleAtLeast(role, "editor");
  const groups: NavGroup[] = [
    {
      titleKey: "shell.groups.events",
      items: [
        { key: "calendar", labelKey: "shell.nav.calendar", href: base, icon: "calendar" },
        { key: "events", labelKey: "shell.nav.events", href: `${base}/events`, icon: "list" },
        {
          key: "templates",
          labelKey: "shell.nav.templates",
          href: `${base}/templates`,
          icon: "layers",
        },
      ],
    },
    {
      titleKey: "shell.groups.setup",
      items: [
        { key: "feeds", labelKey: "shell.nav.feeds", href: clubSettings.feeds, icon: "rss" },
        {
          key: "settings",
          labelKey: "shell.nav.settings",
          href: `${base}/settings`,
          icon: "sliders",
        },
      ],
    },
    {
      titleKey: "shell.groups.club",
      items: [
        myClub,
        {
          key: "clubSettings",
          labelKey: "shell.nav.clubSettings",
          href: clubSettings.locations,
          icon: "map-pin",
        },
        { key: "club", labelKey: "shell.nav.club", href: `/clubs/${clubId}`, icon: "building" },
      ],
    },
  ];
  const hidden: NavKey[] = canEdit ? [] : ["feeds"];
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => !hidden.includes(i.key)) }));
}

export function buildTabs(clubId: string, calendarId: string | null, role?: ClubRole): TabItem[] {
  if (isPlainMember(role) || !calendarId) {
    return [{ key: "me", labelKey: "shell.nav.myClub", href: myClubPath(clubId), icon: "user" }];
  }
  const base = calendarBase(clubId, calendarId);
  const tabs: TabItem[] = [
    { key: "calendar", labelKey: "shell.tabs.calendar", href: base, icon: "calendar" },
    { key: "events", labelKey: "shell.tabs.events", href: `${base}/events`, icon: "list" },
    {
      key: "feeds",
      labelKey: "shell.tabs.feeds",
      href: clubSettingsRoutes(clubId).feeds,
      icon: "rss",
    },
    { key: "more", labelKey: "shell.tabs.more", href: `${base}/more`, icon: "menu" },
  ];
  // Feeds are not readable for viewers.
  return roleAtLeast(role, "editor") ? tabs : tabs.filter((tab) => tab.key !== "feeds");
}

/** Which area the current path belongs to (null = none of the shell areas). */
export function activeNavKey(
  pathname: string,
  clubId: string,
  calendarId: string | null,
): NavKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/profile") return "profile";
  if (path === `/clubs/${clubId}`) return "club";
  if (path === `/clubs/${clubId}/me`) return "me";
  // Club settings (locations, target groups, feeds) have no calendar in the URL.
  const clubSettings = clubSettingsRoutes(clubId);
  if (path.startsWith(clubSettings.feeds)) return "feeds";
  if (path === clubSettings.base || path.startsWith(`${clubSettings.base}/`)) return "clubSettings";
  if (!calendarId) return null;
  const base = calendarBase(clubId, calendarId);
  if (path === base) return "calendar";
  // Design (Export.dc.html): the export page belongs to "Veröffentlichen".
  if (path === `${base}/events/export`) return "feeds";
  if (path.startsWith(`${base}/events`)) return "events";
  if (path.startsWith(`${base}/import`)) return "events";
  if (path.startsWith(`${base}/templates`)) return "templates";
  if (path.startsWith(`${base}/settings`)) return "settings";
  if (path.startsWith(`${base}/more`)) return "more";
  return null;
}

/** Mobile tab for an area (design: Kalender | Termine | Veröffentlichen | Mehr). */
export function tabForNavKey(key: NavKey | null): TabKey | null {
  switch (key) {
    case "calendar":
      return "calendar";
    case "events":
    case "templates":
      return "events";
    case "feeds":
      return "feeds";
    case "me":
      return "me";
    case null:
      return null;
    default:
      return "more";
  }
}

export interface SettingsTab {
  labelKey: string;
  href: string;
}

/** Calendar settings sub-pages (design: SettingsTabs.dc.html). */
export function buildSettingsTabs(clubId: string, calendarId: string): SettingsTab[] {
  const base = `${calendarBase(clubId, calendarId)}/settings`;
  return [
    { labelKey: "shell.settingsTabs.general", href: base },
    { labelKey: "shell.settingsTabs.properties", href: `${base}/properties` },
    { labelKey: "shell.settingsTabs.features", href: `${base}/features` },
    { labelKey: "shell.settingsTabs.holidays", href: `${base}/holiday-calendars` },
  ];
}

/** Club settings sub-pages: locations and target groups (feeds have their own page). */
export function buildClubSettingsTabs(clubId: string): SettingsTab[] {
  const routes = clubSettingsRoutes(clubId);
  return [
    { labelKey: "shell.settingsTabs.locations", href: routes.locations },
    { labelKey: "shell.settingsTabs.targetGroups", href: routes.targetGroups },
  ];
}

export function initials(name: string | undefined | null): string {
  if (!name) return "?";
  return (
    name
      .trim()
      .split(/\s+/)
      .map((s) => s.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}
