import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ClubRole } from "@/lib/types";
import { buildClubSettingsTabs, buildSettingsTabs, type SettingsTab } from "./navigation";

function TabLinks({ tabs, label }: { tabs: SettingsTab[]; label: string }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, "");

  return (
    <nav className="ap-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link key={tab.href} to={tab.href} aria-current={path === tab.href ? "page" : undefined}>
          {t(tab.labelKey)}
        </Link>
      ))}
    </nav>
  );
}

/** Tabs for the calendar settings sub-pages (design: SettingsTabs.dc.html). */
export function SettingsTabs({ clubId, calendarId }: { clubId: string; calendarId: string }) {
  const { t } = useTranslation();
  return (
    <TabLinks tabs={buildSettingsTabs(clubId, calendarId)} label={t("shell.settingsTabs.label")} />
  );
}

/** Tabs for the club settings sub-pages (locations, target groups, feeds); feeds only for editors and admins. */
export function ClubSettingsTabs({ clubId, role }: { clubId: string; role?: ClubRole }) {
  const { t } = useTranslation();
  return (
    <TabLinks
      tabs={buildClubSettingsTabs(clubId, role)}
      label={t("shell.settingsTabs.clubLabel")}
    />
  );
}
