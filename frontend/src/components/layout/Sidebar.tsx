import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon, IconButton, Logo, StatusBadge, Tooltip } from "@/components/ui/shared";
import { cn } from "@/lib/utils";
import { isPlainMember } from "@/lib/club/permissions";
import { HelpCenterLink } from "@/docs/HelpCenterLink";
import { UserMenu } from "./UserMenu";
import { ContextMenu } from "./ContextMenu";
import { CalendarMenuItems, ClubMenuItems } from "./ContextMenuItems";
import { activeNavKey, buildNavGroups, initials, shellCalendarId } from "./navigation";
import type { ShellData } from "./shellTypes";
import { useSidebarCollapsed } from "./useSidebarCollapsed";

export const SIDEBAR_ID = "app-sidebar";

/**
 * Desktop sidebar (288px, or a 72px icon rail when collapsed): logo, club/calendar switchers, navigation,
 * help, user menu (profile, sign out). The collapsed state is stored per browser.
 */
export function Sidebar({ data }: { data: ShellData }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState<"club" | "calendar" | null>(null);
  const [collapsed, setCollapsed] = useSidebarCollapsed();

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
    <aside
      id={SIDEBAR_ID}
      className={cn("ap-side", collapsed && "ap-side--rail")}
      aria-label={t("shell.sidebarLabel")}
    >
      <div className="ap-side-logo">
        <Link to="/" className="no-underline">
          <Logo variant={collapsed ? "mark" : "full"} size={collapsed ? 32 : 40} />
        </Link>
        <Tooltip label={t("shell.toggleSidebar")}>
          <IconButton
            label={t("shell.toggleSidebar")}
            icon={collapsed ? "chevron-right" : "chevron-left"}
            aria-expanded={!collapsed}
            aria-controls={SIDEBAR_ID}
            onClick={() => setCollapsed(!collapsed)}
          />
        </Tooltip>
      </div>

      <div className="ap-ctx">
        <ContextMenu
          caption={t("shell.club")}
          value={club?.name ?? fallback}
          icon="building"
          menuLabel={t("shell.switchClub")}
          collapsed={collapsed}
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
            collapsed={collapsed}
            open={menu === "calendar"}
            onOpenChange={(o) => setMenu(o ? "calendar" : null)}
          >
            <div className="ap-menu-title">{t("shell.switchCalendar")}</div>
            <CalendarMenuItems data={data} onNavigate={close} />
          </ContextMenu>
        )}

        {unavailable && (
          <Tooltip label={t("shell.toClubPicker")} disabled={!collapsed}>
            <Link className="ap-navlink" to="/clubs?select=1">
              <Icon glyph="list" size={20} />
              <span className={collapsed ? "ap-sr" : undefined}>{t("shell.toClubPicker")}</span>
            </Link>
          </Tooltip>
        )}

        {calendar?.archivedAt && (
          <div>
            {collapsed ? (
              <Tooltip label={t("shell.archivedReadOnly")}>
                <span
                  className="ap-railbadge"
                  role="img"
                  aria-label={t("shell.archivedReadOnly")}
                  tabIndex={0}
                >
                  <Icon glyph="archive" size={18} />
                </span>
              </Tooltip>
            ) : (
              <StatusBadge status="archived" label={t("shell.archivedReadOnly")} />
            )}
          </div>
        )}
      </div>

      {(navCalendarId || member) && (
        <nav className="ap-navgroup" aria-label={t("shell.navLabel")}>
          {buildNavGroups(data.clubId, navCalendarId, club?.role).map((group) => (
            <div key={group.titleKey} className="ap-navgroup">
              <div className={cn("ap-navtitle", collapsed && "ap-navtitle--rail")}>
                {t(group.titleKey)}
              </div>
              {group.items.map((item) => (
                <Tooltip key={item.key} label={t(item.labelKey)} disabled={!collapsed}>
                  <Link
                    className="ap-navlink"
                    to={item.href}
                    aria-current={active === item.key ? "page" : undefined}
                  >
                    <Icon glyph={item.icon} size={20} />
                    <span className={collapsed ? "ap-sr" : undefined}>{t(item.labelKey)}</span>
                  </Link>
                </Tooltip>
              ))}
            </div>
          ))}
        </nav>
      )}

      <div className="ap-side-foot">
        <Tooltip label={t("docs.footerLink")} disabled={!collapsed}>
          <HelpCenterLink className="ap-navlink" hideLabel={collapsed}>
            <Icon glyph="info" size={20} />
          </HelpCenterLink>
        </Tooltip>
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
          compact={collapsed}
          side={collapsed ? "right" : "top"}
          align={collapsed ? "end" : "start"}
          closeKey={pathname}
        />
      </div>
    </aside>
  );
}
