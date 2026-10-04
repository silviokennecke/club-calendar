import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/ui/shared";
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
  const fallback = unavailable ? t("shell.unavailable") : t("common.loading");

  return (
    <header className="ap-topbar">
      <Logo variant="mark" size={32} />
      <ContextMenu
        caption={club?.name ?? fallback}
        value={calendar?.name ?? fallback}
        menuLabel={t("shell.switchContext")}
        open={open}
        onOpenChange={setOpen}
      >
        <div className="ap-menu-title">{t("shell.club")}</div>
        <ClubMenuItems data={data} onNavigate={close} withAllClubs={unavailable} />
        <hr />
        <div className="ap-menu-title">{t("shell.calendar")}</div>
        <CalendarMenuItems data={data} onNavigate={close} />
      </ContextMenu>
      <Link className="ap-iconbtn" to="/profile" aria-label={t("shell.profile")}>
        <span className="ap-avatar" aria-hidden="true">
          {initials(data.userName)}
        </span>
      </Link>
    </header>
  );
}
