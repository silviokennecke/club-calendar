import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { parseAnchor, todayIn, visibleRange, type IsoDate } from "@/lib/calendar";
import { helpPath } from "@/docs/paths";
import {
  parseGroupIds,
  publicEventPath,
  publicFeedAddresses,
  viewPathWithoutSecret,
  type PublicFeedData,
} from "@/lib/feeds/public";
import type { ModalNavState } from "@/lib/modalRoutes";
import { PublicCalendarView } from "@/components/feed/PublicCalendarView";
import { PublicShell } from "@/components/feed/PublicShell";
import { PublicError, PublicLoading } from "@/components/feed/PublicStates";
import { SubscribeButton } from "@/components/feed/SubscribeButton";
import { useFeedAccount } from "@/components/feed/useFeedAccount";
import { usePublicFeed } from "@/components/feed/usePublicFeed";
import { EmptyState } from "@/components/ui/shared";
import { preloadPublicEventModal } from "./lazy";

/**
 * Public calendar of a feed (design: Public, PublicMobile, PublicStates). No sign-in, no app
 * shell. Month / list, audience filter, search and the date live in the URL (next to `?secret=`
 * of private feeds); event details open as a dialog above it (`PublicEventModal`).
 */
export default function FeedPage() {
  useEffect(preloadPublicEventModal, []);
  const { t } = useTranslation();
  const { feedId } = useParams<{ feedId: string }>();
  const [params] = useSearchParams();
  const secret = params.get("secret") || undefined;
  // "Today" in the calendar's zone from the API (the browser's until the first answer); only the
  // visible month grid is loaded (the API filters by overlap), the previous month stays while the
  // next one loads.
  const [zone, setZone] = useState<string | null>(null);
  const today = todayIn(zone);
  const anchor = parseAnchor(params.get("date"), today);
  const [from, to] = visibleRange("month", anchor, 1);
  const feed = usePublicFeed(feedId, secret, { from, to });
  const loadedZone = feed.data?.feed.timezone ?? null;
  useEffect(() => {
    if (loadedZone) setZone(loadedZone);
  }, [loadedZone]);

  if (feed.isPending)
    return (
      <PublicShell>
        <PublicLoading />
      </PublicShell>
    );
  if (!feed.data)
    return (
      <PublicShell>
        <PublicError kind={feed.errorKind ?? "error"} onRetry={() => void feed.refetch()} />
      </PublicShell>
    );

  return (
    <PublicShell
      title={`${feed.data.feed.name} – ${t("feed.brand")}`}
      indexable={feed.data.feed.indexable}
      brand={feed.data.feed.clubName}
      footerNote={
        feed.data.feed.timezone && t("feed.timeZoneNote", { zone: feed.data.feed.timezone })
      }
      helpLink={{ to: helpPath("publishing/subscribe"), label: t("shell.helpSubscribe") }}
      hero={<FeedHero data={feed.data} secret={secret} feedId={feedId!} />}
    >
      <FeedCalendar
        data={feed.data}
        feedId={feedId!}
        secret={secret}
        today={today}
        anchor={anchor}
        range={[from, to]}
      />
    </PublicShell>
  );
}

/**
 * Feed name as title (the club name is in the brand row) and the
 * subscribe actions (the audience selection is part of the address).
 */
function FeedHero({
  data,
  feedId,
  secret,
}: {
  data: PublicFeedData;
  feedId: string;
  secret: string | undefined;
}) {
  const [params] = useSearchParams();
  const groupIds = parseGroupIds(params.get("groups"), data.feed.audiences);
  const addresses = publicFeedAddresses(feedId, secret, groupIds);
  const account = useFeedAccount(feedId, secret);

  return (
    <div className="pub-hero">
      <div className="ap-stack ap-stack--sm" style={{ flex: "1 1 420px", minWidth: 0 }}>
        <h1 className="t-display">{data.feed.name}</h1>
      </div>
      <div className="ap-actions" style={{ flex: "0 1 auto" }}>
        <SubscribeButton addresses={addresses} name={data.feed.name} account={account} />
      </div>
    </div>
  );
}

interface FeedCalendarProps {
  data: PublicFeedData;
  feedId: string;
  secret: string | undefined;
  /** Today in the calendar's zone. */
  today: IsoDate;
  anchor: IsoDate;
  /** Loaded days (month grid). */
  range: [IsoDate, IsoDate];
}

function FeedCalendar({ data, feedId, secret, today, anchor, range }: FeedCalendarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const audiences = data.feed.audiences;
  const groupIds = parseGroupIds(params.get("groups"), audiences);

  const update = useCallback(
    (patch: Record<string, string | null>, replace = true) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace },
      ),
    [setParams],
  );

  /** Event details open as a dialog above this view (the view path is stored without the secret). */
  function openEvent(eventId: string) {
    navigate(publicEventPath(feedId, eventId, secret), {
      state: {
        background: viewPathWithoutSecret(location.pathname, location.search),
      } satisfies ModalNavState,
    });
  }

  if (data.feed.eventCount === 0) {
    return (
      <div style={{ padding: "var(--space-8) 0" }}>
        <EmptyState headingLevel="h2" title={t("feed.empty.title")} text={t("feed.empty.text")} />
      </div>
    );
  }

  return (
    <PublicCalendarView
      data={data}
      today={today}
      anchor={anchor}
      range={range}
      view={params.get("view") === "list" ? "list" : "month"}
      query={params.get("q") ?? ""}
      groupIds={groupIds}
      audiences={audiences}
      onOpenEvent={openEvent}
      filterNote={
        groupIds.length > 0 && <p className="t-sm t-muted">{t("feed.subscriptionFilter")}</p>
      }
      onChange={(change, replace) => {
        const patch: Record<string, string | null> = {};
        if (change.date !== undefined) patch.date = change.date;
        if (change.view !== undefined) patch.view = change.view === "list" ? "list" : null;
        if (change.q !== undefined) patch.q = change.q || null;
        if (change.groups !== undefined) {
          patch.groups = change.groups.length > 0 ? change.groups.join(",") : null;
        }
        update(patch, replace);
      }}
    />
  );
}
