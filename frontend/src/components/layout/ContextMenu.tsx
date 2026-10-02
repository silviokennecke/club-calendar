import { useEffect, useId, useRef, type ReactNode } from "react";
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
    <div className="ap-ctxwrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ap-ctxbtn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
      >
        {icon && <Icon glyph={icon} size={22} />}
        <span className="ap-ctxtext">
          <small>{caption}</small>
          <b>{value}</b>
        </span>
        <Icon glyph={open ? "chevron-up" : "chevron-down"} size={18} />
      </button>
      {open && (
        <div className="ap-menu" id={panelId} role="region" aria-label={menuLabel}>
          {children}
        </div>
      )}
    </div>
  );
}
