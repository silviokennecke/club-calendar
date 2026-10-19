import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { releaseVelocity, sheetOffset, shouldDismiss, type DragSample } from "./sheetDrag";

const MOBILE_QUERY = "(max-width: 720px)";
const HANDLE_SELECTOR = "[data-sheet-handle], .ap-dialog-head";
const INTERACTIVE = "button, a, input, select, textarea, label, [role='button'], [contenteditable]";

interface Drag {
  id: number;
  startY: number;
  height: number;
  offset: number;
  samples: DragSample[];
}

function currentOffset(el: HTMLElement): number {
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return m.m42 || 0;
}

/**
 * Drag-to-dismiss of the mobile bottom sheet. Touch/pen only; starts on the grabber
 * (`[data-sheet-handle]`) or the dialog head. The sheet follows the finger downwards, rubber-bands
 * upwards, and on release either closes through `onDismiss` (the dialog's normal close path, so
 * unsaved-changes guards still run) or springs back. If the close is refused (the dialog stays open),
 * it springs back too.
 */
export function useSheetDrag(onDismiss: () => void) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const anim = useRef<Animation | null>(null);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const springBack = useCallback((el: HTMLElement, from: number) => {
    anim.current?.cancel();
    el.style.transform = "";
    el.style.transition = "";
    if (from === 0 || reduced() || typeof el.animate !== "function") return;
    anim.current = el.animate(
      [{ transform: `translateY(${from}px)` }, { transform: "translateY(0)" }],
      { duration: 380, easing: "cubic-bezier(0.22, 1.2, 0.36, 1)" },
    );
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const el = popupRef.current;
    if (!el || e.pointerType === "mouse" || !e.isPrimary || drag.current) return;
    if (!window.matchMedia(MOBILE_QUERY).matches) return;
    const target = e.target as Element;
    const zone = target.closest(HANDLE_SELECTOR);
    if (!zone || !el.contains(zone)) return;
    const interactive = target.closest(INTERACTIVE);
    if (interactive && !interactive.matches("[data-sheet-handle]")) return;
    // Interrupt a running spring-back: continue from where the sheet currently is.
    const start = anim.current ? currentOffset(el) : 0;
    anim.current?.cancel();
    anim.current = null;
    el.style.transition = "none";
    el.style.transform = start ? `translateY(${start}px)` : "";
    drag.current = {
      id: e.pointerId,
      startY: e.clientY - start,
      height: el.getBoundingClientRect().height,
      offset: start,
      samples: [{ y: e.clientY, t: e.timeStamp }],
    };
    el.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const el = popupRef.current;
    const d = drag.current;
    if (!el || !d || e.pointerId !== d.id) return;
    d.offset = sheetOffset(e.clientY - d.startY, d.height);
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 8) d.samples.shift();
    el.style.transform = `translateY(${d.offset}px)`;
  }, []);

  const finish = useCallback(
    (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const el = popupRef.current;
      const d = drag.current;
      if (!el || !d || e.pointerId !== d.id) return;
      drag.current = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      const velocity = releaseVelocity(d.samples);
      if (cancelled || !shouldDismiss(d.offset, velocity, d.height)) {
        springBack(el, d.offset);
        return;
      }
      // Normal close path (may be refused by an unsaved-changes guard).
      const from = d.offset;
      if (reduced()) el.style.transform = "none";
      dismissRef.current();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!el.isConnected) return;
          if (el.hasAttribute("data-ending-style")) {
            // Closing: hand over to the CSS exit transition, which starts at the current offset.
            el.style.transition = "";
            el.style.transform = "";
          } else {
            springBack(el, reduced() ? 0 : from);
          }
        }),
      );
    },
    [springBack],
  );

  return {
    ref: popupRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => finish(e, false),
      onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => finish(e, true),
    },
  };
}
