import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

interface Pending {
  run: () => void;
  /** Undo a navigation the router already started (blocked browser back / forward). */
  cancel?: () => void;
}

/**
 * Warns before unsaved changes get lost (pair with `<UnsavedChangesDialog {...guard.dialog} />`).
 *
 * - asks the browser to confirm reloads / closing the tab (beforeunload),
 * - intercepts clicks on in-app links anywhere on the page (sidebar, tab bar, back links),
 * - wraps the page's own navigation through `guard(fn)`,
 * - blocks the browser's back / forward buttons (the dialog renders a router blocker; only in the
 *   app's data router, plain `<MemoryRouter>` tests skip it).
 * Call `allow()` right before navigating away after saving or deleting.
 */
export function useUnsavedChanges(dirty: boolean) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  // Set once the changes were saved or discarded; navigation is free from then on.
  // (Reset when the form is clean again, e.g. after switching to another item.)
  const allowedRef = useRef(false);
  if (!dirty) allowedRef.current = false;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty && !allowedRef.current;

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
      setPending({ run: () => navigate(to) });
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
    if (dirtyRef.current) setPending({ run: action });
    else action();
  }, []);

  /** The changes are saved (or deliberately dropped): navigate without asking. */
  const allow = useCallback(() => {
    allowedRef.current = true;
    dirtyRef.current = false;
  }, []);

  const shouldBlock = useCallback(() => dirtyRef.current, []);
  const onBlocked = useCallback((proceed: () => void, reset: () => void) => {
    setPending({ run: proceed, cancel: reset });
  }, []);
  // The dialog also reports "closed" right after a confirm: only the first answer counts.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  return {
    guard,
    allow,
    dialog: {
      open: pending !== null,
      onCancel: () => {
        const current = pendingRef.current;
        pendingRef.current = null;
        current?.cancel?.();
        setPending(null);
      },
      onConfirm: () => {
        const action = pendingRef.current;
        pendingRef.current = null;
        allowedRef.current = true;
        dirtyRef.current = false;
        setPending(null);
        action?.run();
      },
      blocker: { shouldBlock, onBlocked },
    },
  };
}
