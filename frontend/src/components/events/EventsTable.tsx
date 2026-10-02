import { Fragment } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatMonthTitle, yearMonthOf } from "@/lib/calendar";
import { formatEventDates, groupByMonth, locationName } from "@/lib/events";
import type { CalendarEvent } from "@/lib/types";
import { StatusBadge, Tag, type TagTone } from "@/components/ui/shared";
import { useLocale } from "@/components/calendar/useLocale";

interface EventsTableProps {
  events: CalendarEvent[];
  caption: string;
  hrefOf: (ev: CalendarEvent) => string;
  /** Router state for the row links (return target). */
  linkState?: unknown;
  toneOf: (groupId: string) => TagTone;
  /** Omit to hide the selection column (read-only calendars). */
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
}

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
}: EventsTableProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const selectable = !!selected && !!onToggle;
  const allChecked = selectable && events.length > 0 && events.every((e) => selected.has(e.id));
  const someChecked = selectable && !allChecked && events.some((e) => selected.has(e.id));
  const columns = selectable ? 8 : 7;

  return (
    <table className="ap-table">
      <caption className="ap-sr">{caption}</caption>
      <thead>
        <tr>
          {selectable && (
            <th scope="col" className="ap-col-check">
              <label className="ap-checkhit">
                <input
                  type="checkbox"
                  aria-label={t("events.list.col.select")}
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={onToggleAll}
                />
              </label>
            </th>
          )}
          <th scope="col">{t("events.list.col.name")}</th>
          <th scope="col">{t("events.list.col.date")}</th>
          <th scope="col">{t("events.list.col.time")}</th>
          <th scope="col">{t("events.list.col.place")}</th>
          <th scope="col">{t("events.list.col.audiences")}</th>
          <th scope="col">{t("events.list.col.features")}</th>
          <th scope="col">{t("events.list.col.status")}</th>
        </tr>
      </thead>
      {groupByMonth(events).map((group) => (
        <tbody key={group.key}>
          <tr>
            <th scope="rowgroup" colSpan={columns} className="ap-table-group">
              {formatMonthTitle(yearMonthOf(group.month), locale)}
            </th>
          </tr>
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
                  <Link className="ap-rowlink" to={hrefOf(ev)} state={linkState}>
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
                </td>
                <td data-label={t("events.list.col.date")}>{dates}</td>
                <td data-label={t("events.list.col.time")}>
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
