const ATTR = "data-initial-focus";

/**
 * Marks a field that got focus without user input (a dialog opening on it). A blur caused by the
 * dialog's own focus handling must not count as "left the field"; the first key or pointer press
 * clears the mark.
 */
export function focusWithoutUser(el: HTMLElement, options?: FocusOptions) {
  el.setAttribute(ATTR, "");
  const clear = () => {
    el.removeAttribute(ATTR);
    document.removeEventListener("keydown", clear, true);
    document.removeEventListener("pointerdown", clear, true);
  };
  document.addEventListener("keydown", clear, true);
  document.addEventListener("pointerdown", clear, true);
  el.focus(options);
}

export function isInitialFocusSteal(el: HTMLElement) {
  return el.hasAttribute(ATTR);
}
