import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGetWithTotal } from "@/lib/api";
import { eventToItem, formatNumericDate } from "@/lib/calendar";
import { formatAddress, type CalendarEvent } from "@/lib/types";
import { Field, StatusBadge, TextInput } from "@/components/ui/shared";
import { itemTimeText } from "./eventDisplay";
import { useLocale } from "./useLocale";

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
const LIMIT = 20;

interface CalendarSearchProps {
  calendarId: string;
  onPick: (event: CalendarEvent) => void;
}

/**
 * Searches the whole calendar on the server (name, note, location, features) and lists the matches
 * in a combobox popup. Reuses the `ap-ac` list styles of `AutocompleteInput`, which cannot show
 * a total count or loading / empty rows.
 */
export function CalendarSearch({ calendarId, onPick }: CalendarSearchProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const listId = useId();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const q = debounced.length >= MIN_CHARS ? debounced : "";
  const { data, isFetching, isError } = useQuery({
    queryKey: ["events", calendarId, "search", q],
    queryFn: ({ signal }) =>
      apiGetWithTotal<CalendarEvent[]>(
        `/api/calendars/${calendarId}/events?q=${encodeURIComponent(q)}&limit=${LIMIT}`,
        signal,
      ),
    enabled: q !== "",
    placeholderData: keepPreviousData,
  });

  const typed = text.trim().length >= MIN_CHARS;
  const visible = open && typed;
  const results = data?.data ?? [];
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

  function choose(ev: CalendarEvent) {
    close();
    onPick(ev);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    const count = results.length;
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
        if (visible && activeIndex >= 0 && results[activeIndex]) {
          e.preventDefault();
          choose(results[activeIndex]);
        }
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
          placeholder={t("calendar.search.placeholderAll")}
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
      </ul>
      {visible && settled && !isError && (
        <span className="ap-sr" role="status" aria-live="polite">
          {t("calendar.search.results", { count: total })}
        </span>
      )}
    </div>
  );
}
