import { useEffect, useRef } from "react";
import { focusPageStart } from "./historyFocus";

let requested: string | null = null;

/**
 * After the routed modal closes, move focus to the first visible element matching `selector`
 * (e.g. the saved event in the calendar: `[data-event-id="…"]`). The background page may still
 * be re-rendering with fresh data, so the element is looked up for a few frames.
 */
export function focusAfterModalClose(selector: string | null) {
  requested = selector;
}

/** CSS selector of an event's items in calendar and list (`data-event-id`). */
export function eventSelector(eventId: string) {
  return `[data-event-id="${eventId.replace(/["\\]/g, "\\$&")}"]`;
}

function firstVisible(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (el.getClientRects().length === 0 || el.closest("[inert]")) continue;
    if (el.closest('[aria-hidden="true"]') || el.tabIndex < 0) continue;
    return el;
  }
  return null;
}

const MAX_FRAMES = 30;

/**
 * Focus return of the routed modals (they close by a route change, not by a trigger): the
 * requested element, else the element that was focused when the modal opened, else the page heading
 * (`h1`, e.g. the month title; deep links have no opener and the saved event may lie outside the
 * visible month), else `#main`.
 */
export function useModalFocusReturn(open: boolean) {
  const trigger = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // Read in render: the dialog moves focus in its effects, the trigger is still focused now.
  if (open && !wasOpen.current && typeof document !== "undefined") {
    trigger.current = document.activeElement as HTMLElement | null;
  }
  const opened = useRef(false);
  wasOpen.current = open;

  useEffect(() => {
    if (open) {
      opened.current = true;
      return;
    }
    if (!opened.current) return;
    opened.current = false;
    const selector = requested;
    requested = null;
    const before = trigger.current;
    trigger.current = null;
    let frames = 0;
    let raf = 0;
    const tick = () => {
      const target = selector ? firstVisible(selector) : null;
      if (target) {
        target.focus();
        return;
      }
      if (selector && frames++ < MAX_FRAMES) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      if (before?.isConnected && before !== document.body) before.focus();
      else focusPageStart();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);
}
