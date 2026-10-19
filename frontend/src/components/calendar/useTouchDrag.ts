import { useEffect, useRef } from "react";
import type { CalItem, IsoDate } from "@/lib/calendar";

/** Hold time before a touch/pen press on a chip turns into a drag. */
export const LONG_PRESS_MS = 400;
/** Movement (px) before the long press fires that cancels it (the user is scrolling/swiping). */
export const LONG_PRESS_SLOP = 8;
/** Distance from the viewport top/bottom edge where the page scrolls while dragging. */
export const EDGE_ZONE = 64;
/** Maximum auto-scroll speed in px per frame. */
export const EDGE_MAX_SPEED = 18;

/** True when the pointer moved far enough that the pending long press must be dropped. */
export function exceedsSlop(dx: number, dy: number, slop = LONG_PRESS_SLOP): boolean {
  return Math.hypot(dx, dy) > slop;
}

/** The day under x for a week body of `days` (equal columns); null outside the body. */
export function resolveDropDate(
  x: number,
  rect: { left: number; width: number },
  days: readonly IsoDate[],
): IsoDate | null {
  if (rect.width <= 0 || days.length === 0 || x < rect.left || x > rect.left + rect.width) {
    return null;
  }
  const col = Math.min(days.length - 1, Math.floor(((x - rect.left) / rect.width) * days.length));
  return days[col] ?? null;
}

/** Scroll step (px, negative = up) for a pointer at y; 0 away from the edges. */
export function edgeScrollDelta(y: number, viewportHeight: number): number {
  if (y < EDGE_ZONE) return -Math.ceil(EDGE_MAX_SPEED * Math.min(1, (EDGE_ZONE - y) / EDGE_ZONE));
  if (y > viewportHeight - EDGE_ZONE) {
    return Math.ceil(EDGE_MAX_SPEED * Math.min(1, (y - (viewportHeight - EDGE_ZONE)) / EDGE_ZONE));
  }
  return 0;
}

/** Date under a point, read from the week body (`data-days`) found with elementFromPoint. */
function dateAt(x: number, y: number): IsoDate | null {
  const body = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-days]");
  if (!body?.dataset.days) return null;
  return resolveDropDate(
    x,
    body.getBoundingClientRect(),
    body.dataset.days.split(",") as IsoDate[],
  );
}

interface Options {
  items: CalItem[];
  /** Same handler the mouse drop uses (permissions, undo toast, series handling stay there). */
  onDrop?: (item: CalItem, date: IsoDate) => void;
  /** Reports the highlighted target day (null = none). */
  onTarget: (date: IsoDate | null) => void;
}

/**
 * Long-press drag for touch and pen (HTML5 drag & drop never fires there). Mouse is ignored and
 * keeps the native drag. Attach the returned `onPointerDown` to the grid; chips opt in with
 * `data-touch-drag` and `data-event-id`.
 *
 * Why no `touch-action: none`: that would block scrolling on every chip. Instead the press must
 * stay within LONG_PRESS_SLOP for LONG_PRESS_MS (so scrolling has not started), then the pointer
 * is captured and a non-passive `touchmove` listener prevents the scroll; `contextmenu`,
 * `selectstart` and `dragstart` are suppressed during the gesture. Only transforms are animated.
 */
export function useTouchDrag({ items, onDrop, onTarget }: Options) {
  const live = useRef({ items, onDrop, onTarget });
  live.current = { items, onDrop, onTarget };
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (e.pointerType === "mouse" || !e.isPrimary || !live.current.onDrop || cleanup.current) {
      return;
    }
    const chip = (e.target as Element).closest<HTMLElement>("[data-touch-drag]");
    const item = chip && live.current.items.find((i) => i.id === chip.dataset.eventId);
    if (!chip || !item) return;

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let x = startX;
    let y = startY;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let target: IsoDate | null = null;
    let raf = 0;
    let timer = 0;
    const rect = chip.getBoundingClientRect();
    const grabX = startX - rect.left;
    const grabY = startY - rect.top;
    const prevOpacity = chip.style.opacity;

    const prevent = (ev: Event) => ev.cancelable && ev.preventDefault();
    const setTarget = (d: IsoDate | null) => {
      if (d === target) return;
      target = d;
      live.current.onTarget(d);
    };
    const place = () => {
      if (ghost) ghost.style.transform = `translate3d(${x - grabX}px,${y - grabY}px,0) scale(1.04)`;
      setTarget(dateAt(x, y));
    };
    const tick = () => {
      const dy = edgeScrollDelta(y, window.innerHeight);
      if (dy !== 0) {
        window.scrollBy(0, dy);
        place();
      }
      raf = requestAnimationFrame(tick);
    };

    const stop = (commit: boolean) => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", key);
      document.removeEventListener("touchmove", prevent);
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("selectstart", prevent);
      document.removeEventListener("dragstart", prevent);
      ghost?.remove();
      chip.style.opacity = prevOpacity;
      document.body.style.userSelect = "";
      document.body.style.setProperty("-webkit-user-select", "");
      if (chip.hasPointerCapture?.(pointerId)) chip.releasePointerCapture(pointerId);
      cleanup.current = null;
      const drop = commit && dragging ? target : null;
      live.current.onTarget(null);
      if (drop && drop !== item.start) live.current.onDrop?.(item, drop);
      if (dragging) {
        // The click that follows the release must not open the event.
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        document.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => document.removeEventListener("click", swallow, true), 300);
      }
    };

    const start = () => {
      dragging = true;
      chip.setPointerCapture?.(pointerId);
      ghost = chip.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-touch-drag");
      ghost.removeAttribute("data-event-id");
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: `${rect.width}px`,
        margin: "0",
        zIndex: "1000",
        pointerEvents: "none",
        boxShadow: "0 8px 24px rgb(0 0 0 / 0.28)",
        willChange: "transform",
        gridColumn: "auto",
        gridRow: "auto",
      });
      document.body.appendChild(ghost);
      chip.style.opacity = "0.35";
      document.body.style.userSelect = "none";
      document.body.style.setProperty("-webkit-user-select", "none");
      document.addEventListener("touchmove", prevent, { passive: false });
      document.addEventListener("selectstart", prevent);
      document.addEventListener("dragstart", prevent);
      place();
      raf = requestAnimationFrame(tick);
    };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      x = ev.clientX;
      y = ev.clientY;
      if (!dragging) {
        if (exceedsSlop(x - startX, y - startY)) stop(false);
        return;
      }
      prevent(ev);
      place();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) stop(ev.type === "pointerup");
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) stop(false);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") stop(false);
    };

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", key);
    document.addEventListener("contextmenu", prevent);
    timer = window.setTimeout(start, LONG_PRESS_MS);
    cleanup.current = () => stop(false);
  }

  return { onPointerDown };
}
