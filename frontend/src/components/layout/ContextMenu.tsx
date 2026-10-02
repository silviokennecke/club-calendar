import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyEvent,
  type ReactNode,
} from "react";
import { Icon, type Glyph } from "@/components/ui/shared";

interface ContextMenuProps {
  /** Small caption above the value (e.g. "Verein"). */
  caption: ReactNode;
  /** Current value (e.g. the club name). */
  value: ReactNode;
  icon?: Glyph;
  /** Accessible name of the opened panel. */
  menuLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Context switcher (design: ap-ctxbtn + ap-menu). Disclosure pattern: the trigger toggles a
 * panel of links/buttons; Escape and clicks outside close it and focus returns to the trigger.
 */
export function ContextMenu({
  caption,
  value,
  icon,
  menuLabel,
  open,
  onOpenChange,
  children,
}: ContextMenuProps) {
  const panelId = `ctx-${useId().replace(/:/g, "")}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);

  // Opened with the arrow keys: move focus into the panel.
  useEffect(() => {
    if (open && focusOnOpen.current) menuItems()[0]?.focus();
    focusOnOpen.current = false;
  }, [open]);

  function menuItems(): HTMLElement[] {
    return Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a[href], button") ?? []);
  }

  function onTriggerKey(e: ReactKeyEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    if (open) menuItems()[0]?.focus();
    else {
      focusOnOpen.current = true;
      onOpenChange(true);
    }
  }

  /** Arrow keys, Home and End move between the entries (Tab and Escape keep working as usual). */
  function onPanelKey(e: ReactKeyEvent<HTMLDivElement>) {
    const items = menuItems();
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (index + 1) % items.length;
    else if (e.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onOpenChange(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div
      className="ap-ctxwrap"
      ref={wrapRef}
      onBlur={(e) => {
        // Tabbing out of the switcher closes it.
        const to = e.relatedTarget as Node | null;
        if (open && to && !wrapRef.current?.contains(to)) onOpenChange(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ap-ctxbtn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        onKeyDown={onTriggerKey}
      >
        {icon && <Icon glyph={icon} size={22} />}
        <span className="ap-ctxtext">
          <small>{caption}</small>
          <b>{value}</b>
        </span>
        <Icon glyph={open ? "chevron-up" : "chevron-down"} size={18} />
      </button>
      {open && (
        <div
          className="ap-menu"
          id={panelId}
          role="region"
          aria-label={menuLabel}
          ref={panelRef}
          onKeyDown={onPanelKey}
        >
          {children}
        </div>
      )}
    </div>
  );
}
