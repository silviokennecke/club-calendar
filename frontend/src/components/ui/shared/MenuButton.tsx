import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type Glyph } from "./Icon";
import { buttonClass, type ButtonVariant } from "./buttonClass";

interface MenuButtonProps {
  label: ReactNode;
  /** Accessible name when the label is hidden or icon-only. */
  ariaLabel?: string;
  icon?: Glyph;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Opens above the button (bars at the bottom of the screen). */
  placement?: "down" | "up";
  className?: string;
  /** Panel content; `close` closes the panel and returns focus to the button. */
  children: (close: () => void) => ReactNode;
}

/**
 * Button that opens a panel (menu list or popover with controls). Escape and clicks outside close
 * it and focus returns to the button.
 */
export function MenuButton({
  label,
  ariaLabel,
  icon,
  variant = "secondary",
  disabled,
  placement = "down",
  className,
  children,
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const panelId = `menu-${useId().replace(/:/g, "")}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div
      ref={wrapRef}
      className={cn("ap-menubtn", className)}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (open && to && !wrapRef.current?.contains(to)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={buttonClass(variant)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {icon && <Icon glyph={icon} size={18} />}
        <span className="ap-menubtn-label">{label}</span>
        <Icon glyph={open ? "chevron-up" : "chevron-down"} size={16} />
      </button>
      {open && (
        <div
          id={panelId}
          className={cn("ap-menu-list ap-menubtn-panel", placement === "up" && "ap-menubtn-up")}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
