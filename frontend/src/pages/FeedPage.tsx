import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { enterListRef } from "@/lib/pageMotion";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  compareItems,
  eventToItem,
  formatMonthTitle,
  holidayToItem,
  overlapsRange,
  parseAnchor,
  stepAnchor,
  todayIn,
  visibleRange,
  yearMonthOf,
  type CalItem,
  type IsoDate,
} from "@/lib/calendar";
import { monthBounds } from "@/lib/events/ics";
import {
  eventsInRange,
  filterPublicEvents,
  parseGroupIds,
  publicEventPath,
  publicFeedAddresses,
  viewPathWithoutSecret,
  type PublicFeedData,
  type PublicFeedEvent,
} from "@/lib/feeds/public";
import { toggleId } from "@/lib/feeds";
import type { ModalNavState } from "@/lib/modalRoutes";
import { formatAddress } from "@/lib/types";
import { useIsMobile } from "@/lib/useMediaQuery";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { EventItem, type EventItemTag } from "@/components/calendar/EventItem";
import { FilterBar } from "@/components/calendar/FilterBar";
import { MonthNav } from "@/components/calendar/MonthNav";
import { MonthView } from "@/components/calendar/MonthView";
import { useLocale } from "@/components/calendar/useLocale";
import { PublicShell } from "@/components/feed/PublicShell";
import { PublicError, PublicLoading } from "@/components/feed/PublicStates";
import { usePublicFeed } from "@/components/feed/usePublicFeed";
import { Button, EmptyState, Icon, buttonClass } from "@/components/ui/shared";
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
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const groupIds = parseGroupIds(params.get("groups"), data.feed.audiences);
  const addresses = publicFeedAddresses(feedId, secret, groupIds);

  return (
    <div className="pub-hero">
      <div className="ap-stack ap-stack--sm" style={{ flex: "1 1 420px", minWidth: 0 }}>
        <h1 className="t-display">{data.feed.name}</h1>
      </div>
      <div className="ap-actions" style={{ flex: "0 1 auto" }}>
        <a className={buttonClass("primary")} style={{ flex: "1 1 auto" }} href={addresses.webcal}>
          <Icon glyph="rss" size={18} />
          {t("feed.subscribe")}
        </a>
        <a
          className={buttonClass("secondary")}
          style={{ flex: "1 1 auto" }}
          href={addresses.ics}
          download
        >
          <Icon glyph="download" size={18} />
          {t("feed.downloadIcs")}
        </a>
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
  const locale = useLocale();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const titleId = `feed-month-${useId().replace(/:/g, "")}`;
  const [panelOpen, setPanelOpen] = useState(false);

  const events = data.events;
  const audiences = data.feed.audiences;
  const view = params.get("view") === "list" ? "list" : "month";
  const query = params.get("q") ?? "";
  const groupIds = parseGroupIds(params.get("groups"), audiences);
  const filtering = query.trim() !== "" || groupIds.length > 0;
  const month = yearMonthOf(anchor);

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

  const filtered = useMemo(
    () => filterPublicEvents(events, groupIds, query),
    [events, groupIds, query],
  );
  const [rangeFrom, rangeTo] = range;
  // Holidays of the calendar like in the internal month view (hidden while filtering)
  const items = useMemo<CalItem[]>(() => {
    const evs: CalItem[] = filtered.map((ev) => eventToItem(ev));
    if (filtering) return evs;
    const holidays = data.holidays
      .map((h) => holidayToItem(h))
      .filter((i) => overlapsRange(i, rangeFrom, rangeTo));
    return [...holidays, ...evs];
  }, [filtered, filtering, data.holidays, rangeFrom, rangeTo]);
  const hasHolidays = items.some((i) => i.kind === "holiday");

  const [first, last] = monthBounds(anchor);
  const monthTotal = eventsInRange(events, first, last).length;
  const monthShown = eventsInRange(filtered, first, last).length;

  function go(date: IsoDate, replace = false) {
    setPanelOpen(false);
    update({ date }, replace);
  }

  /** Event details open as a dialog above this view (the view path is stored without the secret). */
  function openItem(item: CalItem) {
    if (item.kind !== "event") return;
    navigate(publicEventPath(feedId, item.id, secret), {
      state: {
        background: viewPathWithoutSecret(location.pathname, location.search),
      } satisfies ModalNavState,
    });
  }

  const placeOf = (item: CalItem) => {
    if (item.kind !== "event") return null;
    const loc = (item.source as PublicFeedEvent).location;
    return loc ? loc.name || formatAddress(loc) : null;
  };
  const tagsOf = (item: CalItem): EventItemTag[] =>
    item.kind !== "event"
      ? []
      : (item.source as PublicFeedEvent).targetGroups.map(({ targetGroup }) => ({
          id: targetGroup.id,
          label: targetGroup.name,
          tone: audienceTone(audiences.findIndex((g) => g.id === targetGroup.id)),
        }));

  function reset() {
    update({ q: null, groups: null });
  }

  if (data.feed.eventCount === 0) {
    return (
      <div style={{ padding: "var(--space-8) 0" }}>
        <EmptyState headingLevel="h2" title={t("feed.empty.title")} text={t("feed.empty.text")} />
      </div>
    );
  }

  const monthList = items
    .filter((item) => item.kind === "event" && item.start <= last && item.end >= first)
    .sort(compareItems);

  let content;
  if (filtering && filtered.length === 0) {
    content = (
      <EmptyState
        icon="search"
        headingLevel="h2"
        title={
          query.trim()
            ? t("feed.noResults.searchTitle", { query: query.trim() })
            : t("feed.noResults.filterTitle")
        }
        text={t("feed.noResults.text")}
        actions={
          <Button variant="secondary" onClick={reset}>
            {t("feed.noResults.reset")}
          </Button>
        }
      />
    );
  } else if (view === "list") {
    content =
      monthList.length === 0 ? null : (
        <section aria-labelledby={`${titleId}-list`} className="ap-stack ap-stack--sm">
          <h2 className="ap-sr" id={`${titleId}-list`}>
            {t("feed.listHeading", { month: formatMonthTitle(month, locale) })}
          </h2>
          <ul
            ref={enterListRef}
            className="ap-stack ap-stack--sm"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {monthList.map((item) => (
              <li key={item.id}>
                <EventItem
                  item={item}
                  place={placeOf(item)}
                  tags={tagsOf(item)}
                  onOpen={openItem}
                  showStatus={false}
                />
              </li>
            ))}
          </ul>
        </section>
      );
  } else {
    content = (
      <MonthView
        month={month}
        weekStart={1}
        items={items}
        today={today}
        activeDate={anchor}
        selectedDate={anchor}
        panelOpen={panelOpen}
        compact={isMobile}
        labelledBy={titleId}
        onMoveFocus={(date) => update({ date })}
        onSelectDay={(date) => {
          update({ date });
          setPanelOpen(true);
        }}
        onClosePanel={() => setPanelOpen(false)}
        onOpenItem={openItem}
        placeOf={placeOf}
        tagsOf={tagsOf}
        showHolidayLegend={hasHolidays}
        publicView
      />
    );
  }

  return (
    <div className="ap-stack" style={{ paddingTop: "var(--space-6)" }}>
      <div className="ap-row ap-spread" style={{ gap: "var(--space-4)" }}>
        <MonthNav
          as="h2"
          title={formatMonthTitle(month, locale)}
          titleId={titleId}
          onPrev={() => go(stepAnchor("month", anchor, -1))}
          onNext={() => go(stepAnchor("month", anchor, 1))}
          onToday={() => go(today, anchor === today)}
        />
        <div className="ap-seg" role="group" aria-label={t("feed.view.label")}>
          <button
            type="button"
            aria-pressed={view === "month"}
            onClick={() => update({ view: null })}
          >
            {t("feed.view.month")}
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => update({ view: "list" })}
          >
            {t("feed.view.list")}
          </button>
        </div>
      </div>

      <FilterBar
        search={query}
        onSearchChange={(value) => update({ q: value || null })}
        groups={audiences.map((g) => ({ id: g.id, label: g.name }))}
        selectedGroups={groupIds}
        onToggleGroup={(id) => {
          const next = toggleId(groupIds, id);
          update({ groups: next.length > 0 ? next.join(",") : null });
        }}
        onReset={reset}
      />

      <div className="ap-row ap-spread" style={{ gap: "var(--space-2) var(--space-4)" }}>
        <p className="t-label" role="status">
          {t("feed.counter", { count: monthTotal, shown: monthShown })}
        </p>
        <div aria-live="polite">
          {groupIds.length > 0 && <p className="t-sm t-muted">{t("feed.subscriptionFilter")}</p>}
        </div>
      </div>
      {monthTotal === 0 && !filtering && <p className="t-sm t-muted">{t("feed.noneInMonth")}</p>}
      {content}
    </div>
  );
}
