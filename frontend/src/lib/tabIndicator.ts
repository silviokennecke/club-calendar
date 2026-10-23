const TAB_SELECTOR = ".ap-tabs > a, .ap-tabs > button";
const ACTIVE = '[aria-current="page"], [aria-selected="true"], [aria-pressed="true"]';

const hovered = new WeakMap<HTMLElement, HTMLElement>();
const tracked = new Set<HTMLElement>();

function pick(bar: HTMLElement): { el: HTMLElement; hover: boolean } | null {
  const over = hovered.get(bar);
  if (over && over.isConnected && !(over as HTMLButtonElement).disabled) {
    return { el: over, hover: !over.matches(ACTIVE) };
  }
  const active = bar.querySelector<HTMLElement>(`:scope > :is(${ACTIVE})`);
  return active ? { el: active, hover: false } : null;
}

function update(bar: HTMLElement) {
  const target = pick(bar);
  if (!target) {
    bar.removeAttribute("data-slide");
    return;
  }
  const first = !bar.hasAttribute("data-slide");
  bar.style.setProperty("--ind-x", `${target.el.offsetLeft}px`);
  bar.style.setProperty("--ind-w", `${target.el.offsetWidth}px`);
  bar.setAttribute("data-slide", target.hover ? "hover" : "active");
  if (first) {
    // First placement must not slide in from the left.
    bar.removeAttribute("data-anim");
    requestAnimationFrame(() => bar.setAttribute("data-anim", ""));
  }
}

function updateAll() {
  document.querySelectorAll<HTMLElement>(".ap-tabs").forEach((bar) => {
    tracked.add(bar);
    update(bar);
  });
  tracked.forEach((bar) => {
    if (!bar.isConnected) tracked.delete(bar);
  });
}

function barOf(target: EventTarget | null) {
  const tab = (target as Element | null)?.closest?.(TAB_SELECTOR) as HTMLElement | null;
  return tab ? { tab, bar: tab.parentElement as HTMLElement } : null;
}

/**
 * Slides the underline of `.ap-tabs` to the hovered / focused tab and back to the active one
 * (CSS: `.ap-tabs[data-slide]`). Event delegation: works for every tab bar, no component changes.
 */
export function initTabIndicator(): () => void {
  const enter = (e: Event) => {
    const hit = barOf(e.target);
    if (!hit) return;
    hovered.set(hit.bar, hit.tab);
    update(hit.bar);
  };
  const leave = (e: Event) => {
    const hit = barOf(e.target);
    if (!hit) return;
    hovered.delete(hit.bar);
    update(hit.bar);
  };
  document.addEventListener("pointerover", enter);
  document.addEventListener("focusin", enter);
  document.addEventListener("pointerout", leave);
  document.addEventListener("focusout", leave);
  const observer = new MutationObserver(updateAll);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-current", "aria-selected", "aria-pressed"],
  });
  window.addEventListener("resize", updateAll);
  updateAll();
  return () => {
    document.removeEventListener("pointerover", enter);
    document.removeEventListener("focusin", enter);
    document.removeEventListener("pointerout", leave);
    document.removeEventListener("focusout", leave);
    observer.disconnect();
    window.removeEventListener("resize", updateAll);
  };
}
