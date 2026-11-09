import { useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { enterListRef } from "@/lib/pageMotion";
import {
  compareItems,
  eventToItem,
  formatMonthTitle,
  holidayToItem,
  overlapsRange,
  stepAnchor,
  yearMonthOf,
  type CalItem,
  type IsoDate,
} from "@/lib/calendar";
import { monthBounds } from "@/lib/events/ics";
import {
  eventsInRange,
  filterPublicEvents,
  type AudienceOption,
  type PublicFeedData,
  type PublicFeedEvent,
} from "@/lib/feeds/public";
import { toggleId } from "@/lib/feeds";
import { formatAddress } from "@/lib/types";
import { useIsMobile } from "@/lib/useMediaQuery";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { EventItem, type EventItemTag } from "@/components/calendar/EventItem";
import { FilterBar } from "@/components/calendar/FilterBar";
import { MonthNav } from "@/components/calendar/MonthNav";
import { MonthView } from "@/components/calendar/MonthView";
import { useLocale } from "@/components/calendar/useLocale";
import { Button, EmptyState } from "@/components/ui/shared";

export interface CalendarViewChange {
  date?: IsoDate;
  view?: "month" | "list";
  q?: string;
  groups?: string[];
}

interface PublicCalendarViewProps {
  data: PublicFeedData;
  /** Today in the calendar's zone. */
  today: IsoDate;
  anchor: IsoDate;
  /** Loaded days (month grid). */
  range: [IsoDate, IsoDate];
  view: "month" | "list";
  query: string;
  groupIds: string[];
  /** Audiences offered as filter chips (their order decides the tag colours). */
  audiences: AudienceOption[];
  onChange: (change: CalendarViewChange, replace?: boolean) => void;
  onOpenEvent: (eventId: string) => void;
  /** Small note next to the counter (e.g. where the preselected filter comes from). */
  filterNote?: ReactNode;
  /** Keep holidays visible while only audiences are selected (a search always hides them). */
  holidaysWithGroups?: boolean;
}

/**
 * Month / list view with search and audience chips of the public feed page; also used by the
 * personal calendar of "Mein Verein". State (date, view, filters) is owned by the caller.
 */
export function PublicCalendarView({
  data,
  today,
  anchor,
  range,
  view,
  query,
  groupIds,
  audiences,
  onChange,
  onOpenEvent,
  filterNote,
  holidaysWithGroups,
}: PublicCalendarViewProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const isMobile = useIsMobile();
  const titleId = `feed-month-${useId().replace(/:/g, "")}`;
  const [panelOpen, setPanelOpen] = useState(false);

  const events = data.events;
  const filtering = query.trim() !== "" || groupIds.length > 0;
  const hideHolidays = query.trim() !== "" || (groupIds.length > 0 && !holidaysWithGroups);
  const month = yearMonthOf(anchor);

  const filtered = useMemo(
    () => filterPublicEvents(events, groupIds, query),
    [events, groupIds, query],
  );
  const [rangeFrom, rangeTo] = range;
  // Holidays of the calendar like in the internal month view
  const items = useMemo<CalItem[]>(() => {
    const evs: CalItem[] = filtered.map((ev) => eventToItem(ev));
    if (hideHolidays) return evs;
    const holidays = data.holidays
      .map((h) => holidayToItem(h))
      .filter((i) => overlapsRange(i, rangeFrom, rangeTo));
    return [...holidays, ...evs];
  }, [filtered, hideHolidays, data.holidays, rangeFrom, rangeTo]);
  const hasHolidays = items.some((i) => i.kind === "holiday");

  const [first, last] = monthBounds(anchor);
  const monthTotal = eventsInRange(events, first, last).length;
  const monthShown = eventsInRange(filtered, first, last).length;

  function go(date: IsoDate, replace = false) {
    setPanelOpen(false);
    onChange({ date }, replace);
  }

  function openItem(item: CalItem) {
    if (item.kind === "event") onOpenEvent(item.id);
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
    onChange({ q: "", groups: [] });
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
        onMoveFocus={(date) => onChange({ date })}
        onSelectDay={(date) => {
          onChange({ date });
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
            onClick={() => onChange({ view: "month" })}
          >
            {t("feed.view.month")}
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => onChange({ view: "list" })}
          >
            {t("feed.view.list")}
          </button>
        </div>
      </div>

      <FilterBar
        search={query}
        onSearchChange={(value) => onChange({ q: value })}
        groups={audiences.map((g) => ({ id: g.id, label: g.name }))}
        selectedGroups={groupIds}
        onToggleGroup={(id) => onChange({ groups: toggleId(groupIds, id) })}
        onReset={reset}
      />

      <div className="ap-row ap-spread" style={{ gap: "var(--space-2) var(--space-4)" }}>
        <p className="t-label" role="status">
          {t("feed.counter", { count: monthTotal, shown: monthShown })}
        </p>
        <div aria-live="polite">{filterNote}</div>
      </div>
      {monthTotal === 0 && !filtering && <p className="t-sm t-muted">{t("feed.noneInMonth")}</p>}
      {content}
    </div>
  );
}
