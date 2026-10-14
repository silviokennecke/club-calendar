import { useLayoutEffect, useState } from "react";

/**
 * Stack of the open dialogs. Base UI nests a dialog that is rendered inside another one (the
 * confirmation above the event dialog) into the outer dialog's portal; it hides the dialogs below from
 * assistive technology (`aria-hidden`) but leaves them tabbable, so Tab after the last button of the
 * top dialog ended up in the dialog below. Every dialog layer registers its outermost element here;
 * all layers below the top one are `inert` (no focus, no clicks, not in the accessibility tree) until
 * the ones above are gone again.
 */
const layers: HTMLElement[] = [];

function sync() {
  layers.forEach((el, i) => {
    if (i < layers.length - 1) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  });
}

/** Adds a layer on top of the stack; returns the function that removes it. */
export function pushDialogLayer(el: HTMLElement): () => void {
  layers.push(el);
  sync();
  return () => {
    const i = layers.indexOf(el);
    if (i !== -1) layers.splice(i, 1);
    el.removeAttribute("inert");
    sync();
  };
}

/**
 * Registers a dialog as a layer while it is open. Returns the callback ref for the dialog's
 * outermost element (the scrim / popup); the layer ends as soon as `open` turns false, so the dialog
 * below is reachable again before the closing animation and the focus return finish.
 */
export function useDialogLayer(open: boolean) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open || !el) return;
    return pushDialogLayer(el);
  }, [open, el]);
  return setEl;
}
