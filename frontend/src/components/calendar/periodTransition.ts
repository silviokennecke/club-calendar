import { motionEasing, motionMs, prefersReducedMotion } from "@/lib/motion";

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
    {
      duration: motionMs(reduced ? "--dur-fast" : "--dur-base"),
      easing: motionEasing("--ease-out"),
    },
  );
}
