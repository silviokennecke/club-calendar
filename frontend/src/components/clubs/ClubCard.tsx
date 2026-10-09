import { useId, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "@/lib/api";
import { Icon } from "@/components/ui/shared";
import { pickCalendar } from "@/lib/pickCalendar";
import { readLastCalendar } from "@/lib/lastCalendar";
import type { Calendar, Club } from "@/lib/types";

interface ClubCardProps {
  club: Club;
  /** Club and calendar the user worked in last (the card for that club is badged and opens it). */
  lastClubId?: string | null;
  lastCalendarId?: string | null;
  /** Account the per-club calendar choice of this browser belongs to. */
  userId?: string;
}

const calendarsKey = (clubId: string) => ["calendars", clubId, "all"];
const fetchCalendars = (clubId: string) =>
  apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars?includeArchived=true`);

/**
 * Club entry of the club picker (design: ClubPicker): name link, last-used badge, counts. The counts
 * come with `GET /api/clubs`; the calendar list is only loaded for the club that is opened, to pick
 * the calendar (no request per card).
 */
export function ClubCard({ club, lastClubId, lastCalendarId, userId }: ClubCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const metaId = `club-meta-${useId().replace(/:/g, "")}`;

  // Best guess for the link target (new tab, copied link): the calendar remembered for this club,
  // else the account's last one, else the club page. A plain click resolves the real target below.
  const remembered = readLastCalendar(userId, club.id);
  const guessed = remembered ?? (club.id === lastClubId ? lastCalendarId : null);
  const noCalendars = club.calendarCount === 0 && club.archivedCalendarCount === 0;
  const href = noCalendars
    ? `/setup?clubId=${club.id}`
    : guessed
      ? `/clubs/${club.id}/calendars/${guessed}`
      : `/clubs/${club.id}`;

  async function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    try {
      // Same query key as the shell and the club page, so the list is shared.
      const list = await queryClient.fetchQuery({
        queryKey: calendarsKey(club.id),
        queryFn: () => fetchCalendars(club.id),
      });
      const picked = pickCalendar(list, club.id, lastClubId, lastCalendarId, remembered);
      navigate(picked ? `/clubs/${club.id}/calendars/${picked.id}` : `/setup?clubId=${club.id}`);
    } catch {
      // The calendar list could not be loaded: fall back to the club page (it shows its own error).
      navigate(`/clubs/${club.id}`);
    }
  }

  const meta = [
    club.calendarCount !== undefined ? t("clubs.calendars", { count: club.calendarCount }) : null,
    club.memberCount !== undefined ? t("clubs.members", { count: club.memberCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="ap-panel ap-evcard ap-stack ap-stack--sm" style={{ alignItems: "stretch" }}>
      <div className="ap-row ap-spread">
        <h2 className="t-h3">
          <Link to={href} onClick={onClick} aria-describedby={metaId}>
            {club.name}
          </Link>
        </h2>
        {club.id === lastClubId && (
          <span className="ap-badge">
            <Icon glyph="clock" size={14} />
            {t("clubs.lastUsed")}
          </span>
        )}
      </div>
      <p className="t-sm t-muted" id={metaId}>
        {meta || club.timezone}
      </p>
    </article>
  );
}
