import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scrolls to and focuses the element named by the address hash. Sections render after async loads, so
 * it retries for a short while; once per hash.
 */
export function useScrollToHash(ready = true) {
  const { hash } = useLocation();
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !hash || done.current === hash) return;
    const id = decodeURIComponent(hash.slice(1));
    let tries = 0;
    let timer: number | undefined;
    const attempt = () => {
      const el = document.getElementById(id);
      if (el) {
        done.current = hash;
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        if (el.tabIndex < 0 && !el.hasAttribute("tabindex")) el.tabIndex = -1;
        el.classList.add("ap-focus-target");
        el.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });
        el.focus({ preventScroll: true });
        return;
      }
      if (++tries < 20) timer = window.setTimeout(attempt, 100);
    };
    attempt();
    return () => window.clearTimeout(timer);
  }, [hash, ready]);
}
