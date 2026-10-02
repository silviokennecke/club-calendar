import { useId, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "@/lib/api";
import { Icon } from "@/components/ui/shared";
import { pickCalendar } from "@/lib/pickCalendar";
import type { Calendar, Club } from "@/lib/types";

interface ClubCardProps {
  club: Club;
  /** Club and calendar the user worked in last (the card for that club is badged and opens it). */
  lastClubId?: string | null;
  lastCalendarId?: string | null;
}

const calendarsKey = (clubId: string) => ["calendars", clubId, "all"];
const fetchCalendars = (clubId: string) =>
  apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars?includeArchived=true`);

/** Club entry of the club picker (design: ClubPicker): name link, last-used badge, counts. */
export function ClubCard({ club, lastClubId, lastCalendarId }: ClubCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const metaId = `club-meta-${useId().replace(/:/g, "")}`;

  // Same query keys as the shell and the club page, so the data is shared.
  const { data: calendars } = useQuery<Calendar[]>({
    queryKey: calendarsKey(club.id),
    queryFn: () => fetchCalendars(club.id),
  });
  const { data: members } = useQuery<unknown[]>({
    queryKey: ["members", club.id],
    queryFn: () => apiGet(`/api/clubs/${club.id}/members`),
  });

  const target = calendars ? pickCalendar(calendars, club.id, lastClubId, lastCalendarId) : null;
  const href = !calendars
    ? `/clubs/${club.id}`
    : target
      ? `/clubs/${club.id}/calendars/${target.id}`
      : `/setup?clubId=${club.id}`;

  // The counts are still loading: resolve the target first so the click never lands on the wrong page.
  async function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (calendars || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    try {
      const list = await queryClient.fetchQuery({
        queryKey: calendarsKey(club.id),
        queryFn: () => fetchCalendars(club.id),
      });
      const picked = pickCalendar(list, club.id, lastClubId, lastCalendarId);
      navigate(picked ? `/clubs/${club.id}/calendars/${picked.id}` : `/setup?clubId=${club.id}`);
    } catch {
      // The calendar list could not be loaded: fall back to the club page (it shows its own error).
      navigate(`/clubs/${club.id}`);
    }
  }

  const activeCalendars = calendars?.filter((c) => !c.archivedAt).length;
  const meta = [
    activeCalendars !== undefined ? t("clubs.calendars", { count: activeCalendars }) : null,
    members ? t("clubs.members", { count: members.length }) : null,
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
