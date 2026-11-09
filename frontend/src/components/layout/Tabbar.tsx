import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/shared";
import type { ClubRole } from "@/lib/types";
import { activeNavKey, buildTabs, tabForNavKey } from "./navigation";

interface TabbarProps {
  clubId: string;
  /** Role of the signed-in user (viewers get no feeds tab). */
  role?: ClubRole;
  /** Null for a plain member (no calendars): the bar then holds only "Mein Verein". */
  calendarId: string | null;
}

/** Mobile bottom tabs: Kalender, Termine, Veröffentlichen, Mehr. */
export function Tabbar({ clubId, calendarId, role }: TabbarProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const tabs = buildTabs(clubId, calendarId, role);
  const navTab = tabForNavKey(activeNavKey(pathname, clubId, calendarId));
  // Staff reach "Mein Verein" through "Mehr".
  const activeTab = navTab === "me" && !tabs.some((tab) => tab.key === "me") ? "more" : navTab;

  return (
    <nav className="ap-tabbar" aria-label={t("shell.tabsLabel")}>
      {tabs.map((tab) => (
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
