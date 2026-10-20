import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatMonthTitle, yearMonthOf } from "@/lib/calendar";
import {
  DEFAULT_SORT,
  formatEventDates,
  groupByMonth,
  locationName,
  nextSort,
  type SortKey,
  type SortState,
} from "@/lib/events";
import type { CalendarEvent } from "@/lib/types";
import { Button, Icon, StatusBadge, Tag, type TagTone } from "@/components/ui/shared";
import { useLocale } from "@/components/calendar/useLocale";
import { enterTableRef } from "@/lib/pageMotion";

interface EventsTableProps {
  events: CalendarEvent[];
  caption: string;
  hrefOf: (ev: CalendarEvent) => string;
  /** Router state for the row links (the event dialog opens above the list). */
  linkState?: unknown;
  toneOf: (groupId: string) => TagTone;
  /** Omit to hide the selection column (read-only calendars). */
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
  /** Current sort; with `onSort` the name, date, place and status headers become sort buttons. */
  sort?: SortState;
  onSort?: (next: SortState) => void;
  /** The window shrinks back to the first chunk whenever this changes (filters, search). */
  resetKey?: string;
}

/** Rows rendered at first and added by each "show more" (lists can hold up to 5000 events). */
export const EVENTS_PAGE_SIZE = 100;

/**
 * Event table (design: Events.dc.html ap-table). Rows are grouped by month (row group headers);
 * below 720px the CSS turns every row into a card with field labels (data-label).
 */
export function EventsTable({
  events,
  caption,
  hrefOf,
  linkState,
  toneOf,
  selected,
  onToggle,
  onToggleAll,
  sort = DEFAULT_SORT,
  onSort,
  resetKey = "",
}: EventsTableProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const selectable = !!selected && !!onToggle;
  const allChecked = selectable && events.length > 0 && events.every((e) => selected.has(e.id));
  const someChecked = selectable && !allChecked && events.some((e) => selected.has(e.id));
  const columns = selectable ? 8 : 7;
  // Incremental rendering: select-all and bulk actions still cover every event (props), only the DOM rows are windowed.
  const [shown, setShown] = useState(EVENTS_PAGE_SIZE);
  const windowKey = `${resetKey}|${sort.key}|${sort.dir}`;
  const [seenKey, setSeenKey] = useState(windowKey);
  if (seenKey !== windowKey) {
    setSeenKey(windowKey);
    setShown(EVENTS_PAGE_SIZE);
  }
  const visible = events.length > shown ? events.slice(0, shown) : events;
  const remaining = events.length - visible.length;
  // Month groups only make sense while the list is ordered by date.
  const grouped = sort.key === "date";
  const groups = grouped ? groupByMonth(visible) : [{ key: "all", month: null, events: visible }];

  function sortTh(key: SortKey, label: string) {
    if (!onSort) return <th scope="col">{label}</th>;
    const active = sort.key === key;
    const next = nextSort(sort, key);
    const action =
      next.key === DEFAULT_SORT.key && next.dir === "asc" && active ? "reset" : next.dir;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          className="ap-sortbtn"
          aria-label={t(`events.list.sort.${action}`, { col: label })}
          onClick={() => onSort(next)}
        >
          {label}
          <Icon
            glyph={
              !active ? "chevrons-up-down" : sort.dir === "asc" ? "chevron-up" : "chevron-down"
            }
            size={14}
          />
        </button>
      </th>
    );
  }

  return (
    <div className="ap-tablescroll">
      <p className="ap-sr" role="status">
        {onSort
          ? t(`events.list.sort.state.${sort.dir}`, { col: t(`events.list.col.${sort.key}`) })
          : ""}
      </p>
      <table ref={enterTableRef} className="ap-table">
        <caption className="ap-sr">{caption}</caption>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="ap-col-check">
                <label className="ap-checkhit">
                  <input
                    type="checkbox"
                    aria-label={t("events.list.col.select", { count: events.length })}
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked;
                    }}
                    onChange={onToggleAll}
                  />
                </label>
              </th>
            )}
            {sortTh("name", t("events.list.col.name"))}
            {sortTh("date", t("events.list.col.date"))}
            <th scope="col">{t("events.list.col.time")}</th>
            {sortTh("place", t("events.list.col.place"))}
            <th scope="col">{t("events.list.col.audiences")}</th>
            <th scope="col">{t("events.list.col.features")}</th>
            {sortTh("status", t("events.list.col.status"))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            {group.month && (
              <tr>
                <th scope="rowgroup" colSpan={columns} className="ap-table-group">
                  {formatMonthTitle(yearMonthOf(group.month), locale)}
                </th>
              </tr>
            )}
            {group.events.map((ev) => {
              const isSel = selectable && selected.has(ev.id);
              const withIcons = ev.properties.filter((p) => p.property.icon);
              const dates = formatEventDates(ev, locale);
              return (
                <tr key={ev.id} data-selected={isSel || undefined}>
                  {selectable && (
                    <td className="ap-col-check">
                      <label className="ap-checkhit">
                        <input
                          type="checkbox"
                          aria-label={t("events.list.selectOne", { name: ev.name, date: dates })}
                          checked={isSel}
                          onChange={() => onToggle(ev.id)}
                        />
                      </label>
                    </td>
                  )}
                  <td data-label={t("events.list.col.name")}>
                    <Link
                      className="ap-rowlink"
                      to={hrefOf(ev)}
                      state={linkState}
                      data-event-id={ev.id}
                    >
                      {ev.name}
                    </Link>
                    {withIcons.length > 0 && (
                      <>
                        {" "}
                        <span
                          className="ap-ico"
                          role="img"
                          aria-label={withIcons.map((p) => p.property.name).join(", ")}
                        >
                          {withIcons.map((p) => p.property.icon).join("")}
                        </span>
                      </>
                    )}
                    {ev.seriesId && (
                      <>
                        {" "}
                        <Tag tone="brand">{t("events.recurring")}</Tag>
                      </>
                    )}
                  </td>
                  <td data-label={t("events.list.col.date")} className="ap-col-nowrap">
                    {dates}
                  </td>
                  <td data-label={t("events.list.col.time")} className="ap-col-nowrap">
                    {ev.isAllDay
                      ? t("events.list.allDay")
                      : t("events.list.timeRange", {
                          from: ev.timeBegin.slice(0, 5),
                          to: ev.timeEnd.slice(0, 5),
                        })}
                  </td>
                  <td data-label={t("events.list.col.place")}>
                    {ev.location ? locationName(ev.location) : <Empty />}
                  </td>
                  <td data-label={t("events.list.col.audiences")}>
                    {ev.targetGroups.length > 0 ? (
                      <div className="cc-tags">
                        {ev.targetGroups.map(({ targetGroup }) => (
                          <Tag key={targetGroup.id} tone={toneOf(targetGroup.id)}>
                            {targetGroup.name}
                          </Tag>
                        ))}
                      </div>
                    ) : (
                      <Empty />
                    )}
                  </td>
                  <td data-label={t("events.list.col.features")}>
                    {ev.features.length > 0 ? (
                      ev.features.map((f, i) => (
                        <Fragment key={f.feature.id}>
                          {i > 0 && ", "}
                          {f.feature.name}
                        </Fragment>
                      ))
                    ) : (
                      <Empty />
                    )}
                  </td>
                  <td data-label={t("events.list.col.status")}>
                    <StatusBadge status={ev.isDraft ? "draft" : "published"} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      {events.length > EVENTS_PAGE_SIZE && (
        <div className="ap-row" style={{ padding: "var(--space-3) var(--space-4)" }}>
          <p className="t-sm t-muted" role="status">
            {t("events.list.shownOf", { shown: visible.length, count: events.length })}
          </p>
          {remaining > 0 && (
            <Button variant="secondary" onClick={() => setShown((n) => n + EVENTS_PAGE_SIZE)}>
              {t("events.list.showMore", { count: Math.min(remaining, EVENTS_PAGE_SIZE) })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Empty() {
  const { t } = useTranslation();
  return (
    <>
      <span aria-hidden="true">{t("events.list.none")}</span>
      <span className="ap-sr">{t("events.list.noneLabel")}</span>
    </>
  );
}
