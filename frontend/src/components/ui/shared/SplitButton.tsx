import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Icon, type Glyph } from "./Icon";
import { buttonClass } from "./buttonClass";

export interface SplitButtonItem {
  key: string;
  label: ReactNode;
  icon?: Glyph;
  /** Router target (rendered as a link) … */
  to?: string;
  /** … or an action. */
  onSelect?: () => void;
}

interface SplitButtonProps {
  /** Main action label (e.g. "Termin anlegen"). */
  label: ReactNode;
  icon?: Glyph;
  onClick: () => void;
  /** Accessible name of the menu toggle (e.g. "Weitere Wege, Termine anzulegen"). */
  menuLabel: string;
  items: SplitButtonItem[];
  className?: string;
}

/**
 * Primary action with a small menu of alternatives (design: ap-splitbtn). Disclosure pattern:
 * the toggle has aria-expanded; arrow keys move between entries, Escape and clicks outside close
 * the menu and focus returns to the toggle.
 */
export function SplitButton({
  label,
  icon,
  onClick,
  menuLabel,
  items,
  className,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const menuId = `split-${useId().replace(/:/g, "")}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusFirst = useRef(false);

  function entries(): HTMLElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLElement>("a, button") ?? []);
  }

  useEffect(() => {
    if (open && focusFirst.current) entries()[0]?.focus();
    focusFirst.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onToggleKey(e: ReactKeyEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    if (open) entries()[0]?.focus();
    else {
      focusFirst.current = true;
      setOpen(true);
    }
  }

  function onListKey(e: ReactKeyEvent<HTMLUListElement>) {
    const list = entries();
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (index + 1) % list.length;
    else if (e.key === "ArrowUp") next = (index - 1 + list.length) % list.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    if (next === null) return;
    e.preventDefault();
    list[next]?.focus();
  }

  return (
    <div
      ref={wrapRef}
      className={cn("ap-splitbtn", className)}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (open && to && !wrapRef.current?.contains(to)) setOpen(false);
      }}
    >
      <button type="button" className={buttonClass("primary")} onClick={onClick}>
        {icon && <Icon glyph={icon} size={18} />}
        {label}
      </button>
      <button
        ref={toggleRef}
        type="button"
        className={buttonClass("primary", false, "ap-splitbtn-toggle")}
        aria-label={menuLabel}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onToggleKey}
      >
        <Icon glyph={open ? "chevron-up" : "chevron-down"} size={18} />
      </button>
      {open && (
        <ul id={menuId} ref={listRef} className="ap-menu-list" onKeyDown={onListKey}>
          {items.map((item) => (
            <li key={item.key}>
              {item.to ? (
                <Link to={item.to} onClick={() => setOpen(false)}>
                  {item.icon && <Icon glyph={item.icon} size={18} />}
                  {item.label}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
                >
                  {item.icon && <Icon glyph={item.icon} size={18} />}
                  {item.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
