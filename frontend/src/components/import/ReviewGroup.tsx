import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  groupPlace,
  placeLabel,
  resolvePlace,
  selectionState,
  type ImportGroup,
} from "@/lib/import";
import { formatEventDates } from "@/lib/events";
import type { Location } from "@/lib/types";
import { Button, Icon, StatusBadge } from "@/components/ui/shared";
import { useLocale } from "@/components/calendar/useLocale";

/** Rows rendered per group at first and added by each "show more" (files can hold thousands of events). */
const GROUP_PAGE_SIZE = 100;

interface ReviewGroupProps {
  group: ImportGroup;
  locations: Location[];
  duplicates: Set<string>;
  /** Entries the backend would reject (first message by item id). */
  invalid: Map<string, string>;
  /** Entries with warnings (e.g. replaced time zone). */
  warned: Map<string, unknown[]>;
  open: boolean;
  onToggleOpen: () => void;
  onToggleGroup: () => void;
  onToggleItem: (id: string) => void;
  onEditGroup: () => void;
  onEditItem: (id: string) => void;
}

/**
 * One group of the review list (design: ImportReview): header with expand button, tri-state
 * checkbox, place badge and "edit group"; the events of the group in a table below it.
 */
export function ReviewGroup({
  group,
  locations,
  duplicates,
  invalid,
  warned,
  open,
  onToggleOpen,
  onToggleGroup,
  onToggleItem,
  onEditGroup,
  onEditItem,
}: ReviewGroupProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { items } = group;
  // Only the first rows of a group are rendered; selection and counts always cover all events.
  const [shown, setShown] = useState(GROUP_PAGE_SIZE);
  const visible = items.slice(0, shown);
  const remaining = items.length - visible.length;
  const focusRow = useRef<number | null>(null);
  const name = group.name ?? t("import.review.othersName");
  const state = selectionState(items);
  const selected = items.filter((i) => i.selected).length;
  const place = groupPlace(items, locations);
  const tableId = `grp-${group.key.replace(/\W/g, "_")}`;
  const countText = group.showName
    ? t("import.review.singleCount", { count: items.length })
    : t("import.review.groupCount", { count: items.length });
  const isNewPlace = place !== "mixed" && place.kind === "new";

  // After "show more" focus moves to the first new row (the button may disappear).
  useEffect(() => {
    if (focusRow.current === null) return;
    const index = focusRow.current;
    focusRow.current = null;
    document
      .querySelector<HTMLElement>(`#${tableId} tbody tr:nth-child(${index + 1}) input`)
      ?.focus();
  }, [shown, tableId]);

  function showMore() {
    focusRow.current = visible.length;
    setShown((n) => n + GROUP_PAGE_SIZE);
  }

  const checkLabel =
    state === "all"
      ? t("import.review.groupAll", { name, count: items.length })
      : state === "some"
        ? t("import.review.groupSome", { name, selected, count: items.length })
        : t("import.review.groupNone", { name });

  return (
    <li className="ap-reviewgroup">
      <div className="ap-row" style={{ padding: "var(--space-3) var(--space-4)" }}>
        <button
          type="button"
          className="ap-iconbtn"
          aria-expanded={open}
          aria-controls={tableId}
          aria-label={t(open ? "import.review.collapse" : "import.review.expand", { name })}
          onClick={onToggleOpen}
        >
          <Icon glyph={open ? "chevron-up" : "chevron-down"} size={20} />
        </button>
        <label className="ap-checkhit">
          <input
            type="checkbox"
            aria-label={checkLabel}
            checked={state === "all"}
            ref={(el) => {
              if (el) el.indeterminate = state === "some";
            }}
            onChange={onToggleGroup}
          />
        </label>
        <div className="ap-grow" style={{ minWidth: 200 }}>
          <h3 className="t-h3">{name}</h3>
          <p className="t-sm t-muted">{countText}</p>
        </div>
        {state === "some" && (
          <span className="ap-count" style={{ minWidth: "auto", padding: "0 var(--space-2)" }}>
            {t("import.review.mixedCount", { selected, count: items.length })}
          </span>
        )}
        <span className={cn("ap-badge", isNewPlace && "ap-badge--new")}>
          <Icon glyph={isNewPlace ? "plus" : "map-pin"} size={14} />
          {place === "mixed"
            ? t("import.review.placeMixed")
            : place.kind === "none"
              ? t("import.review.placeNone")
              : place.kind === "new"
                ? t("import.review.placeNew", { name: placeLabel(place, locations) })
                : t("import.review.placeExisting", { name: placeLabel(place, locations) })}
        </span>
        <Button
          variant="secondary"
          aria-label={t("import.review.editGroupLabel", { name })}
          onClick={onEditGroup}
        >
          {t("import.review.editGroup")}
        </Button>
      </div>
      {open && (
        <div id={tableId} style={{ borderTop: "1px solid var(--border)" }}>
          <table className="ap-table">
            <caption className="ap-sr">{t("import.review.caption", { name })}</caption>
            <thead>
              <tr>
                <th scope="col" className="ap-col-check">
                  <span className="ap-sr">{t("import.review.col.select")}</span>
                </th>
                {group.showName && <th scope="col">{t("import.review.col.name")}</th>}
                <th scope="col">{t("import.review.col.date")}</th>
                <th scope="col">{t("import.review.col.time")}</th>
                <th scope="col">{t("import.review.col.place")}</th>
                <th scope="col">{t("import.review.col.status")}</th>
                <th scope="col" className="ap-col-actions">
                  <span className="ap-sr">{t("import.review.col.action")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const dates = formatEventDates(item, locale);
                const itemPlace = placeLabel(resolvePlace(item, locations), locations);
                return (
                  <tr key={item.id} data-selected={item.selected || undefined}>
                    <td className="ap-col-check">
                      <label className="ap-checkhit">
                        <input
                          type="checkbox"
                          aria-label={t("import.review.selectOne", {
                            name: item.name,
                            date: dates,
                          })}
                          checked={item.selected}
                          onChange={() => onToggleItem(item.id)}
                        />
                      </label>
                    </td>
                    {group.showName && (
                      <td data-label={t("import.review.col.name")}>
                        <b>{item.name}</b>
                      </td>
                    )}
                    <td data-label={t("import.review.col.date")}>{dates}</td>
                    <td data-label={t("import.review.col.time")}>
                      {item.isAllDay
                        ? t("events.list.allDay")
                        : t("events.list.timeRange", { from: item.timeBegin, to: item.timeEnd })}
                    </td>
                    <td data-label={t("import.review.col.place")}>
                      {itemPlace || t("import.review.noPlace")}
                    </td>
                    <td data-label={t("import.review.col.status")}>
                      <div className="ap-row" style={{ gap: "var(--space-2)" }}>
                        <StatusBadge status={item.status} />
                        {duplicates.has(item.id) && (
                          <StatusBadge status="danger" label={t("import.review.duplicate")} />
                        )}
                        {invalid.has(item.id) && (
                          <StatusBadge status="danger" label={t("import.review.invalidBadge")} />
                        )}
                        {warned.has(item.id) && (
                          <span className="ap-badge">
                            <Icon glyph="clock" size={14} />
                            {t("import.review.timezoneBadge")}
                          </span>
                        )}
                        {item.recurring && (
                          <span className="ap-badge">
                            <Icon glyph="repeat" size={14} />
                            {t("import.review.recurring")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="ap-col-actions">
                      <Button
                        variant="secondary"
                        aria-label={t("import.review.editOneLabel", {
                          name: item.name,
                          date: dates,
                        })}
                        onClick={() => onEditItem(item.id)}
                      >
                        {t("common.edit")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {items.length > GROUP_PAGE_SIZE && (
            <div className="ap-row" style={{ padding: "var(--space-3) var(--space-4)" }}>
              <p className="t-sm t-muted" role="status">
                {t("import.review.shownOf", { shown: visible.length, count: items.length })}
              </p>
              {remaining > 0 && (
                <Button variant="secondary" onClick={showMore}>
                  {t("import.review.showMore", { count: Math.min(remaining, GROUP_PAGE_SIZE) })}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
