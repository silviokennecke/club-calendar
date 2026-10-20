import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { matchModal } from "./modalRoutes";

/**
 * Moves focus to the page heading (else `#main`) after a route change (link, redirect or the
 * browser's back / forward buttons); without it focus stays on `<body>` or on a link of the old page.
 * Skipped for dialogs opening / closing (they have their own focus handling, `modalFocus.ts`) and
 * for changes of the query only (month switch, filters), which keep the page and its focus.
 */
export function focusPageStart(root: Document = document): boolean {
  const heading = root.querySelector<HTMLElement>("main h1, #main h1");
  const target = heading ?? root.getElementById("main");
  if (!target) return false;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  return true;
}

/** Whether a route change should move focus to the page start. */
export function shouldFocusPageStart(fromPath: string, toPath: string): boolean {
  if (fromPath === toPath) return false;
  return !matchModal(fromPath) && !matchModal(toPath);
}

/** A page that already moved focus into its content (first field, own heading) keeps it. */
function focusIsInContent(root: Document): boolean {
  const active = root.activeElement;
  const main = root.getElementById("main");
  return !!main && !!active && active !== main && main.contains(active);
}

export function useHistoryFocus() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (!shouldFocusPageStart(from, pathname)) return;
    // The new page may render its heading a moment later (data); try for a few ticks.
    let frames = 0;
    let timer = 0;
    const tick = () => {
      if (document.querySelector("main h1, #main h1") || frames >= 60) {
        if (!focusIsInContent(document)) focusPageStart();
        return;
      }
      frames += 1;
      timer = window.setTimeout(tick, 16);
    };
    timer = window.setTimeout(tick, 16);
    return () => window.clearTimeout(timer);
  }, [pathname]);
}
