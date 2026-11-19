import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { Icon, Tooltip } from "@/components/ui/shared";
import { cn } from "@/lib/utils";

interface UserMenuProps {
  /** Shown in the avatar circle. */
  initials: string;
  name: string;
  /** Second line of the trigger (e.g. the role); hidden together with the name when `compact`. */
  subtitle?: string;
  /** Accessible name of the menu panel. */
  menuLabel: string;
  /** Avatar only (narrow rail); the name stays available to screen readers. */
  compact?: boolean;
  /** Which edge of the trigger the panel opens at. */
  side?: "top" | "right";
  /** Alignment along that edge: `start` = left/top edge, `end` = right/bottom edge. */
  align?: "start" | "end";
  profileHref: string;
  profileLabel: string;
  profileCurrent?: boolean;
  signOutLabel: string;
  onSignOut: () => void;
  /** Muted line below a divider. */
  footnote?: ReactNode;
  /** Closes the menu when this changes (e.g. the route). */
  closeKey?: string;
}

/** Profile block of the sidebar footer: a button that opens a small menu (profile, sign out). */
export function UserMenu({
  initials,
  name,
  subtitle,
  menuLabel,
  compact = false,
  side = "top",
  align = "start",
  profileHref,
  profileLabel,
  profileCurrent,
  signOutLabel,
  onSignOut,
  footnote,
  closeKey,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = `user-menu-${useId().replace(/:/g, "")}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);

  useEffect(() => setOpen(false), [closeKey]);

  useEffect(() => {
    if (open && focusOnOpen.current) items()[0]?.focus();
    focusOnOpen.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function items(): HTMLElement[] {
    return Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  }

  function onTriggerKey(e: ReactKeyEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (open) items()[0]?.focus();
    else {
      focusOnOpen.current = true;
      setOpen(true);
    }
  }

  function onPanelKey(e: ReactKeyEvent<HTMLDivElement>) {
    const list = items();
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
      className="ap-usermenu"
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (open && to && !wrapRef.current?.contains(to)) setOpen(false);
      }}
    >
      <Tooltip label={name} side="right" disabled={!compact || open}>
        <button
          ref={triggerRef}
          type="button"
          className={cn("ap-usertrigger", compact && "ap-usertrigger-compact")}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={compact ? [name, subtitle].filter(Boolean).join(", ") : undefined}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onTriggerKey}
        >
          <span className="ap-avatar" aria-hidden="true">
            {initials}
          </span>
          {!compact && (
            <>
              <span className="ap-usertext">
                <b>{name}</b>
                {subtitle && <small>{subtitle}</small>}
              </span>
              <Icon glyph="chevrons-up-down" size={18} />
            </>
          )}
        </button>
      </Tooltip>
      {open && (
        <div
          id={panelId}
          role="menu"
          aria-label={menuLabel}
          ref={panelRef}
          onKeyDown={onPanelKey}
          className={cn("ap-usermenu-panel", `ap-um-${side}`, `ap-um-${align}`)}
        >
          <Link
            role="menuitem"
            className="ap-menuitem"
            to={profileHref}
            aria-current={profileCurrent ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            <Icon glyph="user" size={20} />
            <span>{profileLabel}</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            className="ap-menuitem ap-menuitem-danger"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <Icon glyph="log-out" size={20} />
            <span>{signOutLabel}</span>
          </button>
          {footnote && (
            <>
              <hr />
              <div className="ap-usermenu-note">{footnote}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
