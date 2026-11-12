import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PROFILE_TABS } from "./profileTabsConfig";

export function ProfileTabs() {
  const { t } = useTranslation();
  const path = useLocation().pathname.replace(/\/+$/, "");
  return (
    <nav className="ap-tabs" aria-label={t("profile.tabs.label")}>
      {PROFILE_TABS.map((tab) => (
        <Link key={tab.key} to={tab.href} aria-current={path === tab.href ? "page" : undefined}>
          {t(tab.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
