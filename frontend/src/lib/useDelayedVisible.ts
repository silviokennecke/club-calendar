import { useEffect, useRef, useState } from "react";
import { LOADER_MIN_VISIBLE_MS, loaderDelayMs } from "./motion";

/**
 * Visibility of a loading indicator: appears `delay` ms after `active` turned true and, once shown,
 * stays at least `minVisible` ms. Fast operations never show it. State (aria-busy) is the caller's job.
 */
export function useDelayedVisible(
  active: boolean,
  delay: number = loaderDelayMs(),
  minVisible: number = LOADER_MIN_VISIBLE_MS,
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delay);
      return () => clearTimeout(timer);
    }
    const remaining = shownAt.current + minVisible - Date.now();
    if (remaining <= 0) {
      const timer = setTimeout(() => setVisible(false), 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [active, delay, minVisible]);

  return visible;
}
