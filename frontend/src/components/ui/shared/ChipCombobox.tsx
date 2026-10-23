import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { rankByRelevance } from "@/lib/fuzzySearch";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { Chip, type ChipOption } from "./ChipSelect";

/** Suggestions shown for an empty input (oldest first). */
const EMPTY_QUERY_LIMIT = 5;
const MAX_RESULTS = 8;

interface ChipComboboxProps {
  label: ReactNode;
  /** All available options; only the selected ones are shown as chips. */
  options: ChipOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  hint?: ReactNode;
  /** Enables the last "create" option; must return the id of the created option. */
  onCreate?: (name: string) => Promise<string> | string;
  /** Text of the trailing add chip and accessible name of the input. */
  addLabel: string;
  className?: string;
}

type Row = { kind: "option"; option: ChipOption } | { kind: "create" };

/**
 * Multi-select that shows only the assigned entries as chips. A trailing add chip turns into a
 * combobox: Enter takes the highlighted suggestion (the first one by default), the last row
 * creates a new entry from the typed text. Options are ordered by id, which is creation order
 * for UUID v7 (the API has no createdAt).
 */
export function ChipCombobox({
  label,
  options,
  selected,
  onChange,
  hint,
  onCreate,
  addLabel,
  className,
}: ChipComboboxProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const skipFocusOpen = useRef(false);

  const text = query.trim();
  const rows = useMemo<Row[]>(() => {
    const free = options.filter((o) => !selected.includes(o.id));
    const found = text
      ? rankByRelevance(free, text, ["label"]).slice(0, MAX_RESULTS)
      : [...free].sort((a, b) => a.id.localeCompare(b.id)).slice(0, EMPTY_QUERY_LIMIT);
    const list: Row[] = found.map((option) => ({ kind: "option", option }));
    if (onCreate) list.push({ kind: "create" });
    return list;
  }, [options, selected, text, onCreate]);

  const rowId = (i: number) => `${listId}-${i}`;
  const current = Math.min(active, rows.length - 1);

  function close(refocus: boolean) {
    setEditing(false);
    setQuery("");
    setActive(0);
    if (refocus) {
      skipFocusOpen.current = true;
      requestAnimationFrame(() => {
        addRef.current?.focus();
        skipFocusOpen.current = false;
      });
    }
  }

  function remove(id: string) {
    onChange(selected.filter((s) => s !== id));
  }

  async function choose(row: Row | undefined) {
    if (!row || busy) return;
    if (row.kind === "option") {
      onChange([...selected, row.option.id]);
    } else {
      if (!text || !onCreate) return;
      setBusy(true);
      try {
        const id = await onCreate(text);
        onChange([...selected, id]);
      } catch {
        // The caller reports the failure (toast); the text stays for another try.
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((current + 1) % rows.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((current - 1 + rows.length) % rows.length);
        break;
      case "Enter":
        e.preventDefault();
        void choose(rows[current]);
        break;
      case "Escape":
        // Close the list without closing a surrounding dialog.
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case "Backspace":
        if (!query && selected.length > 0) remove(selected[selected.length - 1]);
        break;
    }
  }

  const byId = new Map(options.map((o) => [o.id, o]));
  const chips = selected.flatMap((id) => {
    const o = byId.get(id);
    return o ? [o] : [];
  });

  return (
    <fieldset className={cn("ap-fieldset", className)}>
      <legend>{label}</legend>
      <div className="ap-chips">
        {chips.map((o) => (
          <Chip key={o.id} pressed onClick={() => remove(o.id)}>
            {o.label}
          </Chip>
        ))}
        {editing ? (
          <div
            className="ap-ac"
            style={{ flex: "1 1 14rem", maxWidth: "22rem" }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) close(false);
            }}
          >
            <input
              ref={inputRef}
              className="cc-input"
              role="combobox"
              aria-label={addLabel}
              aria-autocomplete="list"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={rowId(current)}
              autoComplete="off"
              spellCheck={false}
              name="new-chip-name"
              autoFocus
              value={query}
              readOnly={busy}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
            <ul
              id={listId}
              role="listbox"
              className="ap-ac-list"
              aria-label={addLabel}
              onMouseDown={(e) => e.preventDefault()}
            >
              {rows.map((row, i) => (
                <li
                  key={row.kind === "create" ? "create" : row.option.id}
                  id={rowId(i)}
                  role="option"
                  aria-selected={i === current}
                  aria-disabled={row.kind === "create" && !text ? true : undefined}
                  className="ap-ac-option"
                  onClick={() => void choose(row)}
                  onMouseMove={() => i !== current && setActive(i)}
                >
                  {row.kind === "option" ? (
                    row.option.label
                  ) : (
                    <>
                      <Icon glyph="plus" size={16} />
                      &nbsp;
                      {text
                        ? t("ui.chipCombobox.createNamed", { name: text })
                        : t("ui.chipCombobox.createHint")}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <button
            ref={addRef}
            type="button"
            className="ap-chip ap-chip--add"
            onClick={() => setEditing(true)}
            onFocus={() => !skipFocusOpen.current && setEditing(true)}
          >
            <Icon glyph="plus" size={16} />
            {addLabel}
          </button>
        )}
      </div>
      {hint && <span className="cc-hint">{hint}</span>}
    </fieldset>
  );
}
