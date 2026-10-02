import { useEffect, useRef, type KeyboardEvent } from "react";
import { gridKeyTarget, type IsoDate, type WeekStart } from "@/lib/calendar";

interface Options {
  /** The date whose cell is in the tab order (roving tabindex). */
  activeDate: IsoDate;
  weekStart: WeekStart;
  /** Arrow/Home/End/PageUp/PageDown: the new active date (may be in another month). */
  onMove: (date: IsoDate) => void;
  /** Enter/Space on a day. */
  onActivate: (date: IsoDate) => void;
}

/**
 * Keyboard support for a date grid with a roving tabindex. Day buttons carry `data-date`;
 * after a move the button of the new active date receives focus (also after a month change,
 * once the new month is rendered).
 */
export function useGridKeyboard({ activeDate, weekStart, onMove, onActivate }: Options) {
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-date="${activeDate}"]`);
    if (el) {
      pendingFocus.current = false;
      el.focus();
    }
  });

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-date]");
    const date = cell?.dataset.date;
    if (!date) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate(date);
      return;
    }
    const target = gridKeyTarget(date, e.key, weekStart, e.shiftKey);
    if (!target) return;
    e.preventDefault();
    pendingFocus.current = true;
    onMove(target);
  }

  return { gridRef, onKeyDown };
}
