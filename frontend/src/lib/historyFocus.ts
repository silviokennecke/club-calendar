import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { matchModal } from "./modalRoutes";

/**
 * Moves focus to the page heading (else `#main`) after a route change by the browser's back / forward
 * buttons; without it focus stays on `<body>` because the focused link or button no longer exists.
 * Skipped for dialogs opening / closing (they have their own focus handling, `modalFocus.ts`) and
 * for changes of the query only (month switch, filters), which keep the page and its focus.
 */
function focusPageStart(root: Document = document): boolean {
  const heading = root.querySelector<HTMLElement>("main h1, #main h1");
  const target = heading ?? root.getElementById("main");
  if (!target) return false;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  return true;
}

/** Whether a route change should move focus to the page start. */
export function shouldFocusPageStart(
  navigationType: string,
  fromPath: string,
  toPath: string,
): boolean {
  if (navigationType !== "POP" || fromPath === toPath) return false;
  return !matchModal(fromPath) && !matchModal(toPath);
}

export function useHistoryFocus() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  const previous = useRef(pathname);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (!shouldFocusPageStart(type, from, pathname)) return;
    // The new page may render its heading a moment later (data); try for a few ticks.
    let frames = 0;
    let timer = 0;
    const tick = () => {
      if (document.querySelector("main h1, #main h1") || frames >= 20) {
        focusPageStart();
        return;
      }
      frames += 1;
      timer = window.setTimeout(tick, 16);
    };
    timer = window.setTimeout(tick, 16);
    return () => window.clearTimeout(timer);
  }, [pathname, type]);
}
