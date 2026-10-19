import { useCallback, useEffect, useRef } from "react";

/** Pixels of horizontal travel before a gesture is committed (hysteresis). */
export const SWIPE_HYSTERESIS = 10;
/** Share of the board width the projected end position must exceed. */
export const SWIPE_THRESHOLD = 0.35;
/** Velocity (px/s) that commits a swipe on its own. */
export const SWIPE_MIN_VELOCITY = 500;

/** Where a release would land: v in px/s, deceleration rate 0.998 (UIScrollView). */
export function project(velocity: number): number {
  return ((velocity / 1000) * 0.998) / (1 - 0.998);
}

/** Axis lock: undefined while undecided, "x" to take the gesture, "y" to leave it to scrolling. */
export function lockAxis(dx: number, dy: number): "x" | "y" | undefined {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_HYSTERESIS) return undefined;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/**
 * Decide on release: -1 = previous period (swipe right), 1 = next (swipe left), 0 = spring back.
 * Uses the projected position against a width share; a fast flick commits regardless of distance.
 */
export function decideSwipe(dx: number, velocity: number, width: number): -1 | 0 | 1 {
  if (width <= 0) return 0;
  const projected = dx + project(velocity);
  const fast = Math.abs(velocity) >= SWIPE_MIN_VELOCITY && Math.sign(velocity) === Math.sign(dx);
  if (Math.abs(projected) < width * SWIPE_THRESHOLD && !fast) return 0;
  if (dx === 0) return 0;
  return dx > 0 ? -1 : 1;
}

/** Rubber-banding when there is no further period (kept for a finite resistance on the drag). */
export function damp(dx: number, width: number): number {
  const limit = Math.max(width, 1);
  const abs = Math.abs(dx);
  return Math.sign(dx) * limit * (1 - 1 / ((abs * 0.55) / limit + 1));
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

const IGNORE = 'input, select, textarea, [draggable="true"], [data-no-swipe]';

interface Options {
  onPrev: () => void;
  onNext: () => void;
  enabled?: boolean;
}

/**
 * Touch/pen swipe between periods. Attach the returned ref to the board container; the content
 * follows the finger 1:1 (transform only). Mouse is ignored so text selection and event drag & drop
 * keep working. Buttons/keyboard remain the accessible alternative.
 */
export function useSwipeNav<T extends HTMLElement>({ onPrev, onNext, enabled = true }: Options) {
  const elRef = useRef<T | null>(null);
  const handlers = useRef({ onPrev, onNext });
  handlers.current = { onPrev, onNext };

  const setRef = useCallback((node: T | null) => {
    elRef.current = node;
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !enabled) return;
    el.style.touchAction = "pan-y";
    let id: number | null = null;
    let startX = 0;
    let startY = 0;
    let axis: "x" | "y" | undefined;
    let samples: { t: number; x: number }[] = [];
    let anim: Animation | null = null;

    const reset = () => {
      id = null;
      axis = undefined;
      samples = [];
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !e.isPrimary || id !== null) return;
      if (e.target instanceof Element && e.target.closest(IGNORE)) return;
      anim?.cancel();
      id = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      samples = [{ t: e.timeStamp, x: e.clientX }];
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - startX;
      if (!axis) {
        axis = lockAxis(dx, e.clientY - startY);
        if (axis === "x") el.setPointerCapture(e.pointerId);
        else if (axis === "y") return reset();
        else return;
      }
      samples.push({ t: e.timeStamp, x: e.clientX });
      if (samples.length > 5) samples.shift();
      // 1:1 after the hysteresis has been crossed (no jump), slight damping far out.
      const eff = dx - Math.sign(dx) * SWIPE_HYSTERESIS;
      el.style.transform = `translate3d(${eff}px,0,0)`;
    };

    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const wasX = axis === "x";
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = first && last ? last.t - first.t : 0;
      const v = dt > 0 && first && last ? ((last.x - first.x) / dt) * 1000 : 0;
      const dx = e.clientX - startX - Math.sign(e.clientX - startX) * SWIPE_HYSTERESIS;
      const dir = e.type === "pointercancel" || !wasX ? 0 : decideSwipe(dx, v, el.clientWidth);
      reset();
      if (!wasX) return;
      el.style.transform = "";
      if (dir === 0) {
        if (!prefersReducedMotion()) {
          anim = el.animate(
            [{ transform: `translate3d(${dx}px,0,0)` }, { transform: "translate3d(0,0,0)" }],
            { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          );
        }
        return;
      }
      if (dir < 0) handlers.current.onPrev();
      else handlers.current.onNext();
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      anim?.cancel();
      el.style.transform = "";
      el.style.touchAction = "";
    };
  }, [enabled]);

  return setRef;
}

/**
 * Slide the new period in from the side it came from (interruptible WAAPI, transform + opacity);
 * a plain cross-fade under reduced motion.
 */
export function playPeriodTransition(el: HTMLElement | null, direction: -1 | 1) {
  if (!el || typeof el.animate !== "function") return;
  el.getAnimations().forEach((a) => a.cancel());
  const reduced = prefersReducedMotion();
  const from = reduced ? "none" : `translate3d(${direction * 32}px,0,0)`;
  el.animate(
    [
      { opacity: 0, transform: from },
      { opacity: 1, transform: "none" },
    ],
    { duration: reduced ? 120 : 160, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  );
}
