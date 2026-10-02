import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/shared";
import { activeNavKey, buildTabs, tabForNavKey } from "./navigation";

interface TabbarProps {
  clubId: string;
  calendarId: string;
}

/** Mobile bottom tabs: Kalender, Termine, Veröffentlichen, Mehr. */
export function Tabbar({ clubId, calendarId }: TabbarProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const activeTab = tabForNavKey(activeNavKey(pathname, clubId, calendarId));

  return (
    <nav className="ap-tabbar" aria-label={t("shell.tabsLabel")}>
      {buildTabs(clubId, calendarId).map((tab) => (
        <Link
          key={tab.key}
          className="ap-tab"
          to={tab.href}
          aria-current={activeTab === tab.key ? "page" : undefined}
        >
          <span className="ap-tabicon">
            <Icon glyph={tab.icon} size={22} />
          </span>
          {t(tab.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
