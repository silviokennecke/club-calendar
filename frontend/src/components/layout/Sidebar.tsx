import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon, Logo, StatusBadge } from "@/components/ui/shared";
import { isPlainMember } from "@/lib/club/permissions";
import { ContextMenu } from "./ContextMenu";
import { CalendarMenuItems, ClubMenuItems } from "./ContextMenuItems";
import { activeNavKey, buildNavGroups, initials } from "./navigation";
import type { ShellData } from "./shellTypes";

/** Desktop sidebar (288px): logo, club/calendar switchers, navigation, profile, sign out. */
export function Sidebar({ data }: { data: ShellData }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState<"club" | "calendar" | null>(null);

  // Close any open switcher when the route changes.
  useEffect(() => setMenu(null), [pathname]);

  const active = activeNavKey(pathname, data.clubId, data.calendarId);
  const club = data.clubs.find((c) => c.id === data.clubId);
  const calendar = data.calendars.find((c) => c.id === data.calendarId);
  const close = () => setMenu(null);
  const unavailable = data.contextState === "unavailable";
  const member = isPlainMember(club?.role);
  const fallback = unavailable ? t("shell.unavailable") : t("common.loading");

  return (
    <aside className="ap-side" aria-label={t("shell.sidebarLabel")}>
      <div className="ap-side-logo">
        <Link to="/" className="no-underline">
          <Logo />
        </Link>
      </div>

      <div className="ap-ctx">
        <ContextMenu
          caption={t("shell.club")}
          value={club?.name ?? fallback}
          icon="building"
          menuLabel={t("shell.switchClub")}
          open={menu === "club"}
          onOpenChange={(o) => setMenu(o ? "club" : null)}
        >
          <div className="ap-menu-title">{t("shell.switchClub")}</div>
          <ClubMenuItems data={data} onNavigate={close} />
        </ContextMenu>

        {!member && (
          <ContextMenu
            caption={t("shell.calendar")}
            value={calendar?.name ?? fallback}
            icon="calendar"
            menuLabel={t("shell.switchCalendar")}
            open={menu === "calendar"}
            onOpenChange={(o) => setMenu(o ? "calendar" : null)}
          >
            <div className="ap-menu-title">{t("shell.switchCalendar")}</div>
            <CalendarMenuItems data={data} onNavigate={close} />
          </ContextMenu>
        )}

        {unavailable && (
          <Link className="ap-navlink" to="/clubs?select=1">
            <Icon glyph="list" size={20} />
            {t("shell.toClubPicker")}
          </Link>
        )}

        {calendar?.archivedAt && (
          <div>
            <StatusBadge status="archived" label={t("shell.archivedReadOnly")} />
          </div>
        )}
      </div>

      {(data.calendarId || member) && (
        <nav className="ap-navgroup" aria-label={t("shell.navLabel")}>
          {buildNavGroups(data.clubId, data.calendarId, club?.role).map((group) => (
            <div key={group.titleKey} className="ap-navgroup">
              <div className="ap-navtitle">{t(group.titleKey)}</div>
              {group.items.map((item) => (
                <Link
                  key={item.key}
                  className="ap-navlink"
                  to={item.href}
                  aria-current={active === item.key ? "page" : undefined}
                >
                  <Icon glyph={item.icon} size={20} />
                  {t(item.labelKey)}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      )}

      <div className="ap-side-foot">
        <Link
          className="ap-navlink"
          to="/profile"
          aria-current={active === "profile" ? "page" : undefined}
        >
          <span className="ap-avatar" aria-hidden="true">
            {initials(data.userName)}
          </span>
          <span className="ap-grow">
            {data.userName}
            <span className="ap-sr">, {t("shell.profile")}</span>
          </span>
        </Link>
        <Link className="ap-navlink" to="/help">
          <Icon glyph="info" size={20} />
          {t("docs.footerLink")}
        </Link>
        <button type="button" className="ap-navlink" onClick={data.onLogout}>
          <Icon glyph="log-out" size={20} />
          {t("shell.signOut")}
        </button>
      </div>
    </aside>
  );
}
