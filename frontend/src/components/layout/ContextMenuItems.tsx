import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/shared";
import type { ShellData } from "./shellTypes";
import { useClubCreationAllowed } from "@/lib/registration";
import { calendarSwitchPath } from "./calendarSwitchPath";

interface ItemsProps {
  data: ShellData;
  onNavigate: () => void;
}

/** Club entries of the context switcher (design: "Verein wechseln"). */
export function ClubMenuItems({
  data,
  onNavigate,
  withAllClubs = true,
}: ItemsProps & { withAllClubs?: boolean }) {
  const { t } = useTranslation();
  const { allowed: clubCreationAllowed } = useClubCreationAllowed();
  return (
    <>
      {data.clubs.map((club) => {
        const current = club.id === data.clubId;
        return (
          <button
            key={club.id}
            type="button"
            className="ap-menuitem"
            aria-current={current ? "true" : undefined}
            onClick={() => {
              onNavigate();
              if (!current) data.onSelectClub(club.id);
            }}
          >
            <Icon glyph="building" size={18} />
            <span>{club.name}</span>
            {current && <Icon glyph="check" size={18} />}
          </button>
        );
      })}
      {withAllClubs && (
        <>
          <hr />
          <Link className="ap-menuitem" to="/clubs?select=1" onClick={onNavigate}>
            <Icon glyph="list" size={18} />
            <span>{t("shell.allClubs")}</span>
          </Link>
        </>
      )}
      {clubCreationAllowed && (
        <Link className="ap-menuitem" to="/setup?new=1" onClick={onNavigate}>
          <Icon glyph="plus" size={18} />
          <span>{t("shell.newClub")}</span>
        </Link>
      )}
    </>
  );
}

/** Calendar entries of the context switcher (design: "Kalender wechseln"). */
export function CalendarMenuItems({ data, onNavigate }: ItemsProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <>
      {data.calendars.map((cal) => {
        const current = cal.id === data.calendarId;
        const archived = !!cal.archivedAt;
        return (
          <Link
            key={cal.id}
            className="ap-menuitem"
            to={calendarSwitchPath(pathname, data.clubId, cal.id)}
            aria-current={current ? "true" : undefined}
            onClick={onNavigate}
          >
            <Icon glyph={archived ? "archive" : "calendar"} size={18} />
            <span>
              {cal.name}
              {archived && ` ${t("shell.archivedSuffix")}`}
            </span>
            {current && <Icon glyph="check" size={18} />}
          </Link>
        );
      })}
      <hr />
      <Link className="ap-menuitem" to={`/clubs/${data.clubId}`} onClick={onNavigate}>
        <Icon glyph="plus" size={18} />
        <span>{t("shell.manageCalendars")}</span>
      </Link>
    </>
  );
}
