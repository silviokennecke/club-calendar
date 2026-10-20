/** Mirrors of the motion tokens in index.css; the CSS value wins when it can be read. */
const FALLBACK = {
  "--dur-fast": "100ms",
  "--dur-base": "160ms",
  "--dur-slow": "240ms",
  "--dur-exit-base": "100ms",
  "--dur-exit-slow": "160ms",
  "--dur-sheet-spring": "380ms",
  "--ease-out": "cubic-bezier(0.22, 1, 0.36, 1)",
  "--ease-sheet-spring": "cubic-bezier(0.22, 1.2, 0.36, 1)",
} as const;

export type MotionToken = keyof typeof FALLBACK;

/** Minimum time a shown spinner stays visible (avoids a flash right after it appeared). */
export const LOADER_MIN_VISIBLE_MS = 300;
/** Fallback of `--loader-delay` (spinners appear after it). */
export const LOADER_DELAY_MS = 150;

function cssValue(token: MotionToken): string {
  const read =
    typeof document !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue(token).trim()
      : "";
  return read || FALLBACK[token];
}

export function motionEasing(token: MotionToken): string {
  return cssValue(token);
}

export function motionMs(token: MotionToken): number {
  const raw = cssValue(token);
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.endsWith("ms") ? value : value * 1000;
}

export function loaderDelayMs(): number {
  const read =
    typeof document !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue("--loader-delay").trim()
      : "";
  const value = parseFloat(read);
  return Number.isFinite(value) ? value : LOADER_DELAY_MS;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}
