import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { eventToItem, formatNumericDate } from "@/lib/calendar";
import type { PublicFeedEvent } from "@/lib/feeds/public";
import { formatAddress, type CalendarEvent } from "@/lib/types";
import { Field, StatusBadge, TextInput } from "@/components/ui/shared";
import { itemTimeText } from "./eventDisplay";
import { useLocale } from "./useLocale";

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
/** Number of previews in the popup. */
export const SEARCH_LIMIT = 10;

export type SearchEvent = CalendarEvent | PublicFeedEvent;

interface CalendarSearchProps {
  /** Identifies the data source (calendar, feed, subscription) in the query cache. */
  scope: readonly unknown[];
  /** Up to `SEARCH_LIMIT` matches and their total count. */
  search: (q: string, signal: AbortSignal) => Promise<{ data: SearchEvent[]; total: number }>;
  onPick: (event: SearchEvent) => void;
  /** Opens the list view with the search term applied. */
  onShowAll: (q: string) => void;
  placeholder: string;
  /** Text to start with (the term of the list view). */
  initialText?: string;
}

/**
 * Autocomplete search of every calendar view: up to ten previews in a combobox popup, a click opens
 * the event, the last entry always leads to the list with all results. Reuses the `ap-ac` list
 * styles of `AutocompleteInput`, which cannot show a total count or loading / empty rows.
 */
export function CalendarSearch({
  scope,
  search,
  onPick,
  onShowAll,
  placeholder,
  initialText = "",
}: CalendarSearchProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const listId = useId();
  const [text, setText] = useState(initialText);
  const [debounced, setDebounced] = useState(initialText.trim());
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const q = debounced.length >= MIN_CHARS ? debounced : "";
  const { data, isFetching, isError } = useQuery({
    queryKey: [...scope, "search", q],
    queryFn: ({ signal }) => search(q, signal),
    enabled: q !== "",
    placeholderData: keepPreviousData,
  });

  const typed = text.trim().length >= MIN_CHARS;
  const visible = open && typed;
  const results = (data?.data ?? []).slice(0, SEARCH_LIMIT);
  const total = data?.total ?? results.length;
  const settled = q === text.trim() && !isFetching;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  function close() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function choose(ev: SearchEvent) {
    close();
    onPick(ev);
  }

  function showAll() {
    const term = text.trim();
    close();
    onShowAll(term);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    const count = results.length + 1;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (!typed) return;
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (count === 0) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((i) => (i < 0 ? (step > 0 ? 0 : count - 1) : (i + step + count) % count));
        return;
      }
      case "Enter":
        if (!visible) return;
        e.preventDefault();
        if (activeIndex >= 0 && results[activeIndex]) choose(results[activeIndex]);
        else showAll();
        return;
      case "Escape":
        if (visible) {
          e.stopPropagation();
          close();
        }
        return;
    }
  }

  const status = !visible
    ? null
    : isError
      ? t("calendar.search.error")
      : !settled
        ? t("calendar.search.loading")
        : results.length === 0
          ? t("calendar.search.empty", { query: q })
          : null;

  return (
    <div className="ap-ac">
      <Field id="calendar-search" label={t("calendar.search.label")}>
        <TextInput
          ref={inputRef}
          type="search"
          name="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={listId}
          aria-activedescendant={visible && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={close}
          onKeyDown={handleKeyDown}
        />
      </Field>
      <ul
        id={listId}
        role="listbox"
        className="ap-ac-list"
        hidden={!visible}
        aria-label={t("calendar.search.label")}
        onMouseDown={(e) => e.preventDefault()}
      >
        {visible && status && (
          <li role="presentation" className="ap-ac-note">
            {status}
          </li>
        )}
        {visible &&
          !isError &&
          results.map((ev, i) => {
            const active = i === activeIndex;
            const item = eventToItem(ev);
            const place = ev.location ? ev.location.name || formatAddress(ev.location) : null;
            return (
              <li
                key={ev.id}
                id={optionId(i)}
                role="option"
                aria-selected={active}
                className="ap-ac-option ap-ac-option--stack"
                onClick={() => choose(ev)}
                onMouseMove={() => !active && setActiveIndex(i)}
              >
                <span className="ap-ac-title">
                  {ev.name}
                  {ev.isDraft && <StatusBadge status="draft" />}
                </span>
                <span className="ap-ac-meta">
                  {[formatNumericDate(item.start, locale), itemTimeText(item, t), place]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            );
          })}
        {visible && !isError && settled && total > results.length && (
          <li role="presentation" className="ap-ac-note">
            {t("calendar.search.more", { shown: results.length, total })}
          </li>
        )}
        {visible && (
          <li
            id={optionId(results.length)}
            role="option"
            aria-selected={activeIndex === results.length}
            className="ap-ac-option"
            onClick={showAll}
            onMouseMove={() => activeIndex !== results.length && setActiveIndex(results.length)}
          >
            <span className="ap-ac-title">{t("calendar.search.showAll")}</span>
          </li>
        )}
      </ul>
      {visible && settled && !isError && (
        <span className="ap-sr" role="status" aria-live="polite">
          {t("calendar.search.results", { count: total })}
        </span>
      )}
    </div>
  );
}
