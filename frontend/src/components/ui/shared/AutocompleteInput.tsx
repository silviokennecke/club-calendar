import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { rankByRelevance } from "@/lib/fuzzySearch";
import { TextInput } from "./Field";

/** Delay before an external (`onSearch`) lookup starts, so fast typing sends one request. */
const SEARCH_DEBOUNCE_MS = 200;

export interface AutocompleteInputProps<T extends { id: string }> extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onSelect" | "role" | "children"
> {
  /** Controlled text of the input. */
  value: string;
  onValueChange: (value: string) => void;
  /** All available items for the built-in fuzzy search (ignored when `onSearch` is set). */
  suggestions?: T[];
  /** Property used as the item label (default "label"). */
  labelKey?: keyof T;
  /** Label of an item; takes precedence over `labelKey`. */
  getLabel?: (item: T) => string;
  /** Custom item template; the default renders the label. */
  renderItem?: (item: T, state: { active: boolean; query: string }) => ReactNode;
  /** Properties the built-in search looks at (default: the label key). */
  searchKeys?: (keyof T)[];
  /** External search; replaces the built-in one. Debounced, the signal aborts stale calls. */
  onSearch?: (query: string, signal: AbortSignal) => Promise<T[]> | T[];
  /** Called after the user chose a suggestion (after `onValueChange(label)`). */
  onSelect: (item: T) => void;
  /** Minimum trimmed characters before a search starts (default 3). */
  minChars?: number;
  /** Maximum number of suggestions shown (default 8). */
  maxResults?: number;
}

function AutocompleteInputInner<T extends { id: string }>(
  {
    value,
    onValueChange,
    suggestions,
    labelKey,
    getLabel,
    renderItem,
    searchKeys,
    onSearch,
    onSelect,
    minChars = 3,
    maxResults = 8,
    onBlur,
    onKeyDown,
    className,
    ...rest
  }: AutocompleteInputProps<T>,
  ref: Ref<HTMLInputElement>,
) {
  const { t } = useTranslation();
  const listId = useId();
  const [results, setResults] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  const labelOf = useCallback(
    (item: T) => (getLabel ? getLabel(item) : String(item[labelKey ?? ("label" as keyof T)] ?? "")),
    [getLabel, labelKey],
  );
  const keys = useMemo(
    () => searchKeys ?? [labelKey ?? ("label" as keyof T)],
    [searchKeys, labelKey],
  );

  /** Drops pending and in-flight work; its results will be ignored. */
  const cancel = useCallback(() => {
    requestRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancel();
    };
  }, [cancel]);

  const close = useCallback(() => {
    cancel();
    setOpen(false);
    setActiveIndex(-1);
  }, [cancel]);

  const show = useCallback(
    (items: T[]) => {
      const limited = items.slice(0, maxResults);
      setResults(limited);
      setActiveIndex(-1);
      setOpen(limited.length > 0);
    },
    [maxResults],
  );

  const search = useCallback(
    (text: string) => {
      cancel();
      const query = text.trim();
      if (query.length < minChars) {
        setResults([]);
        setOpen(false);
        setActiveIndex(-1);
        return;
      }
      if (!onSearch) {
        show(rankByRelevance(suggestions ?? [], query, keys));
        return;
      }
      const id = requestRef.current;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const controller = new AbortController();
        abortRef.current = controller;
        void (async () => {
          try {
            const items = await onSearch(query, controller.signal);
            if (!mountedRef.current || requestRef.current !== id || controller.signal.aborted) {
              return;
            }
            show(items);
          } catch {
            if (!mountedRef.current || requestRef.current !== id) return;
            show([]);
          }
        })();
      }, SEARCH_DEBOUNCE_MS);
    },
    [cancel, minChars, onSearch, show, suggestions, keys],
  );

  const choose = (item: T) => {
    close();
    setResults([]);
    onValueChange(labelOf(item));
    onSelect(item);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onValueChange(e.target.value);
    search(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    const visible = open && results.length > 0;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (!visible) {
          if (e.key === "ArrowDown" && value.trim().length >= minChars) {
            e.preventDefault();
            search(value);
          }
          return;
        }
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        const count = results.length;
        setActiveIndex((i) => (i < 0 ? (step > 0 ? 0 : count - 1) : (i + step + count) % count));
        return;
      }
      case "Enter":
        if (visible && activeIndex >= 0) {
          e.preventDefault();
          choose(results[activeIndex]);
        }
        return;
      case "Tab":
        if (visible && activeIndex >= 0) choose(results[activeIndex]);
        else close();
        return;
      case "Escape":
        if (visible) {
          e.stopPropagation();
          close();
        }
        return;
    }
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    close();
    onBlur?.(e);
  };

  const visible = open && results.length > 0;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  return (
    <div className="ap-ac">
      <TextInput
        {...rest}
        ref={ref}
        className={className}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={visible && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      <ul
        id={listId}
        role="listbox"
        className="ap-ac-list"
        hidden={!visible}
        aria-label={rest["aria-label"]}
        onMouseDown={(e) => e.preventDefault()}
      >
        {visible &&
          results.map((item, i) => {
            const active = i === activeIndex;
            return (
              <li
                key={item.id}
                id={optionId(i)}
                role="option"
                aria-selected={active}
                className="ap-ac-option"
                onClick={() => choose(item)}
                onMouseMove={() => !active && setActiveIndex(i)}
              >
                {renderItem ? renderItem(item, { active, query: value.trim() }) : labelOf(item)}
              </li>
            );
          })}
      </ul>
      <span className="ap-sr" role="status" aria-live="polite">
        {visible ? t("ui.autocomplete.results", { count: results.length }) : ""}
      </span>
    </div>
  );
}

/**
 * Text input with a suggestion list (WAI-ARIA 1.2 combobox, list autocomplete).
 * Built-in fuzzy search over `suggestions`, or an external, debounced and abortable `onSearch`.
 * Works inside `Field` (id/aria props are forwarded to the input).
 */
export const AutocompleteInput = forwardRef(AutocompleteInputInner) as <T extends { id: string }>(
  props: AutocompleteInputProps<T> & { ref?: Ref<HTMLInputElement> },
) => ReactElement;
