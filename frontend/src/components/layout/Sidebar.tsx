import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon, Logo, StatusBadge } from "@/components/ui/shared";
import { isPlainMember } from "@/lib/club/permissions";
import { HelpCenterLink } from "@/docs/HelpCenterLink";
import { UserMenu } from "./UserMenu";
import { ContextMenu } from "./ContextMenu";
import { CalendarMenuItems, ClubMenuItems } from "./ContextMenuItems";
import { activeNavKey, buildNavGroups, initials, shellCalendarId } from "./navigation";
import type { ShellData } from "./shellTypes";

/** Desktop sidebar (288px): logo, club/calendar switchers, navigation, help, user menu (profile, sign out). */
export function Sidebar({ data }: { data: ShellData }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState<"club" | "calendar" | null>(null);

  // Close any open switcher when the route changes.
  useEffect(() => setMenu(null), [pathname]);

  const navCalendarId = shellCalendarId(data);
  const active = activeNavKey(pathname, data.clubId, data.calendarId);
  const club = data.clubs.find((c) => c.id === data.clubId);
  const calendar = data.calendars.find((c) => c.id === navCalendarId);
  const close = () => setMenu(null);
  const unavailable = data.contextState === "unavailable";
  // A plain member without any calendar permission only has Mein Verein.
  const member = isPlainMember(club?.role) && !navCalendarId;
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

      {(navCalendarId || member) && (
        <nav className="ap-navgroup" aria-label={t("shell.navLabel")}>
          {buildNavGroups(data.clubId, navCalendarId, club?.role).map((group) => (
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
        <HelpCenterLink className="ap-navlink">
          <Icon glyph="info" size={20} />
        </HelpCenterLink>
        <UserMenu
          initials={initials(data.userName)}
          name={data.userName}
          subtitle={club?.role ? t(`club.roles.${club.role}`) : undefined}
          menuLabel={t("shell.userMenu")}
          profileHref="/profile"
          profileLabel={t("shell.profileSettings")}
          profileCurrent={active === "profile"}
          signOutLabel={t("shell.signOut")}
          onSignOut={data.onLogout}
          closeKey={pathname}
        />
      </div>
    </aside>
  );
}
