import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { parseAnchor, todayIn, visibleRange } from "@/lib/calendar";
import { isSearchList, parseGroupIds } from "@/lib/feeds/public";
import { myClubPath } from "@/lib/club/myClub";
import {
  getMyEvents,
  myEventsKey,
  useMyEvents,
  useMyFeeds,
  useMySubscription,
} from "@/lib/club/memberApi";
import { openModalState } from "@/lib/modalRoutes";
import { PublicCalendarView } from "@/components/feed/PublicCalendarView";
import { Button, EmptyState, LinkButton, Skeleton } from "@/components/ui/shared";
import { preloadMyEventModal } from "@/pages/lazy";

/**
 * Tab "Kalender" of Mein Verein: the events of the personal subscription in the view of the public
 * feed page. The audience chips start with the subscription's selection (empty = all); changing
 * them here only changes this view, nothing is saved.
 */
export function MyCalendarTab({ clubId }: { clubId: string }) {
  useEffect(preloadMyEventModal, []);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const subscription = useMySubscription(clubId);
  const feeds = useMyFeeds(clubId);
  // null = the subscription's own selection (the server applies it), otherwise the user's choice here.
  const [override, setOverride] = useState<string[] | null>(null);
  const [zone, setZone] = useState<string | null>(null);

  const today = todayIn(zone);
  const anchor = parseAnchor(params.get("date"), today);
  const [from, to] = visibleRange("month", anchor, 1);
  const qc = useQueryClient();
  const view = params.get("view") === "list" ? "list" : "month";
  // The list of a search spans all dates: load without a range (same cache entry as the search).
  const allDates = isSearchList(view, params.get("q") ?? "");
  const targetGroupIds = override ?? undefined;
  const events = useMyEvents(clubId, allDates ? { targetGroupIds } : { from, to, targetGroupIds });
  const loadedZone = events.data?.feed.timezone ?? null;
  useEffect(() => {
    if (loadedZone) setZone(loadedZone);
  }, [loadedZone]);

  const groups = feeds.data?.targetGroups ?? [];
  const subscribed = subscription.data?.targetGroupIds ?? [];
  const groupIds = parseGroupIds((override ?? subscribed).join(","), groups);
  const fromSubscription = override === null && groupIds.length > 0;

  if (subscription.isPending || events.isPending) {
    return (
      <div aria-busy="true">
        <p className="ap-sr" role="status">
          {t("feed.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 360 }} />
      </div>
    );
  }

  if (subscription.isError || events.isError) {
    return (
      <EmptyState
        icon="alert"
        title={t("myClub.calendar.errorTitle")}
        text={t("myClub.calendar.errorText")}
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              void subscription.refetch();
              void events.refetch();
            }}
          >
            {t("myClub.calendar.retry")}
          </Button>
        }
      />
    );
  }

  if (subscription.data.selectedFeedIds.length === 0) {
    return (
      <EmptyState
        icon="rss"
        title={t("myClub.calendar.noFeedsTitle")}
        text={t("myClub.calendar.noFeedsText")}
        actions={
          <LinkButton to={myClubPath(clubId, "subscription")} icon="edit">
            {t("myClub.calendar.chooseFeeds")}
          </LinkButton>
        }
      />
    );
  }

  const data = events.data;
  if (data.feed.eventCount === 0 && groupIds.length === 0) {
    return (
      <EmptyState
        icon="calendar"
        title={t("myClub.calendar.emptyTitle")}
        text={t("myClub.calendar.emptyText")}
      />
    );
  }

  return (
    <PublicCalendarView
      data={data}
      today={today}
      anchor={anchor}
      range={[from, to]}
      view={view}
      query={params.get("q") ?? ""}
      groupIds={groupIds}
      audiences={groups}
      holidaysWithGroups
      filterNote={
        fromSubscription && <p className="t-sm t-muted">{t("myClub.calendar.fromSubscription")}</p>
      }
      searchScope={["my-events", clubId, targetGroupIds ?? null]}
      loadAllEvents={async () =>
        (
          await qc.fetchQuery({
            queryKey: myEventsKey(clubId, { targetGroupIds }),
            queryFn: () => getMyEvents(clubId, { targetGroupIds }),
            staleTime: 60_000,
          })
        ).events
      }
      onOpenEvent={(eventId) =>
        navigate(`/clubs/${encodeURIComponent(clubId)}/me/events/${encodeURIComponent(eventId)}`, {
          state: openModalState(location),
        })
      }
      onChange={(change, replace = true) => {
        if (change.groups !== undefined) setOverride(change.groups);
        const next = new URLSearchParams(params);
        if (change.date !== undefined) next.set("date", change.date);
        if (change.view !== undefined) {
          if (change.view === "list") next.set("view", "list");
          else next.delete("view");
        }
        if (change.q !== undefined) {
          if (change.q) next.set("q", change.q);
          else next.delete("q");
        }
        setParams(next, { replace });
      }}
    />
  );
}
