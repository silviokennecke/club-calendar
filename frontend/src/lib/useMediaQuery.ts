import { useSyncExternalStore } from "react";

/** Mobile breakpoint of the design (cc-app.css). */
const MOBILE_QUERY = "(max-width: 720px)";

function getMql(query: string): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query)
      : null;
  } catch {
    return null;
  }
}

/** Live result of a CSS media query (false where matchMedia is unavailable). */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = getMql(query);
      if (!mql) return () => {};
      mql.addEventListener?.("change", onChange);
      return () => mql.removeEventListener?.("change", onChange);
    },
    () => getMql(query)?.matches ?? false,
    () => false,
  );
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
