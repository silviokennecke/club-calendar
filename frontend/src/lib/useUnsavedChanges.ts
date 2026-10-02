import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Warns before unsaved changes get lost (pair with `<UnsavedChangesDialog {...guard.dialog} />`).
 *
 * The app uses <BrowserRouter> (no data router, so no `useBlocker`); instead this hook
 * - asks the browser to confirm reloads / closing the tab (beforeunload),
 * - intercepts clicks on in-app links anywhere on the page (sidebar, tab bar, back links),
 * - wraps the page's own navigation through `guard(fn)`.
 * The browser's back button is not intercepted.
 */
export function useUnsavedChanges(dirty: boolean) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    function onClick(e: MouseEvent) {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      if (link.closest("[data-unsaved-ignore]")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const current = window.location.pathname + window.location.search;
      if (url.pathname + url.search === current) return;
      e.preventDefault();
      e.stopPropagation();
      const to = url.pathname + url.search + url.hash;
      setPending(() => () => navigate(to));
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, navigate]);

  /** Runs `action` right away, or after the user confirmed discarding the changes. */
  const guard = useCallback((action: () => void) => {
    if (dirtyRef.current) setPending(() => action);
    else action();
  }, []);

  return {
    guard,
    dialog: {
      open: pending !== null,
      onCancel: () => setPending(null),
      onConfirm: () => {
        const action = pending;
        dirtyRef.current = false;
        setPending(null);
        action?.();
      },
    },
  };
}
