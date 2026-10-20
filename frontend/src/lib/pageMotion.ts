import { motionEasing, motionMs, prefersReducedMotion } from "@/lib/motion";

/** Entrance of a list: first rows fade in one after another (`--stagger` in index.css), total < 300 ms. */
export const ENTER_CAP = 10;
export const ENTER_STAGGER_MS = 20;
const ENTER_CLEAR_MS = 400;

/** Marks the first `ENTER_CAP` items for the entrance animation and clears the marks afterwards. */
export function markEnter(items: ArrayLike<Element>): () => void {
  if (prefersReducedMotion()) return () => {};
  const marked: HTMLElement[] = [];
  for (let i = 0; i < Math.min(items.length, ENTER_CAP); i++) {
    const item = items[i] as HTMLElement;
    item.setAttribute("data-enter-i", "");
    item.style.setProperty("--i", String(i));
    marked.push(item);
  }
  const timer = window.setTimeout(clear, ENTER_CLEAR_MS);
  function clear() {
    window.clearTimeout(timer);
    for (const item of marked) {
      item.removeAttribute("data-enter-i");
      item.style.removeProperty("--i");
    }
  }
  return clear;
}

/** Ref for a list element: animates its children only when the list itself mounts (not on sort, filter or chunk reveal). */
export function enterListRef(el: HTMLElement | null) {
  if (el) return markEnter(el.children);
}

/** Same for a table: the rows of the first body. */
export function enterTableRef(el: HTMLElement | null) {
  if (el) return markEnter(el.querySelectorAll("tbody:first-of-type > tr"));
}

/** Subtle entrance of a new page (opacity + a few px, `--dur-base`); not under reduced motion. */
export function playPageEnter(el: HTMLElement | null) {
  if (!el || typeof el.animate !== "function" || prefersReducedMotion()) return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate(
    [
      { opacity: 0, transform: "translate3d(0,6px,0)" },
      { opacity: 1, transform: "none" },
    ],
    { duration: motionMs("--dur-base"), easing: motionEasing("--ease-out") },
  );
}
