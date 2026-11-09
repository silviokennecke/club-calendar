import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/ui/shared";
import { isPlainMember } from "@/lib/club/permissions";
import { ContextMenu } from "./ContextMenu";
import { CalendarMenuItems, ClubMenuItems } from "./ContextMenuItems";
import { initials } from "./navigation";
import type { ShellData } from "./shellTypes";

/** Mobile top bar (<= 720px): logo mark, combined club/calendar switcher, profile. */
export function Topbar({ data }: { data: ShellData }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const club = data.clubs.find((c) => c.id === data.clubId);
  const calendar = data.calendars.find((c) => c.id === data.calendarId);
  const close = () => setOpen(false);
  const unavailable = data.contextState === "unavailable";
  const member = isPlainMember(club?.role);
  const fallback = unavailable ? t("shell.unavailable") : t("common.loading");

  return (
    <header className="ap-topbar">
      <Link to="/" className="no-underline">
        <Logo variant="mark" size={32} />
      </Link>
      <ContextMenu
        caption={member ? t("shell.club") : (club?.name ?? fallback)}
        value={member ? (club?.name ?? fallback) : (calendar?.name ?? fallback)}
        menuLabel={member ? t("shell.switchClub") : t("shell.switchContext")}
        open={open}
        onOpenChange={setOpen}
      >
        <div className="ap-menu-title">{t("shell.club")}</div>
        <ClubMenuItems data={data} onNavigate={close} withAllClubs={unavailable} />
        {!member && (
          <>
            <hr />
            <div className="ap-menu-title">{t("shell.calendar")}</div>
            <CalendarMenuItems data={data} onNavigate={close} />
          </>
        )}
      </ContextMenu>
      {/* The initials are the link's visible text, so the name starts with them (WCAG 2.5.3 label in name). */}
      <Link className="ap-iconbtn" to="/profile">
        <span className="ap-avatar">{initials(data.userName)}</span>
        <span className="ap-sr">, {t("shell.profile")}</span>
      </Link>
    </header>
  );
}
