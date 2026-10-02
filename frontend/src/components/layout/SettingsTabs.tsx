import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildSettingsTabs } from "./navigation";

/** Tabs for the calendar settings sub-pages (design: SettingsTabs.dc.html). */
export function SettingsTabs({ clubId, calendarId }: { clubId: string; calendarId: string }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, "");

  return (
    <nav className="ap-tabs" aria-label={t("shell.settingsTabs.label")}>
      {buildSettingsTabs(clubId, calendarId).map((tab) => (
        <Link key={tab.href} to={tab.href} aria-current={path === tab.href ? "page" : undefined}>
          {t(tab.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
