import { useCallback, useState, type FocusEvent } from "react";
import { isInitialFocusSteal } from "@/lib/initialFocus";

/**
 * Tracks which fields were left (blur) and how often the form was submitted: errors show for a
 * touched field or after the first submit, never while typing into a fresh field. `submits` doubles
 * as ErrorSummary `focusSignal`.
 */
export function useFieldTouch<K extends string>() {
  const [touched, setTouched] = useState<ReadonlySet<K>>(new Set());
  const [submits, setSubmits] = useState(0);
  const touch = useCallback((key: K, e?: FocusEvent<HTMLElement>) => {
    if (e && isInitialFocusSteal(e.currentTarget)) return;
    // focus moving to a plain button or link (Back, Cancel, "Forgot password"): a new error would shift
    // the layout under the pointer and swallow the click
    const next = e?.relatedTarget;
    if (next instanceof HTMLAnchorElement) return;
    if (next instanceof HTMLButtonElement && next.type === "button") return;
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  const submit = useCallback(() => setSubmits((n) => n + 1), []);
  return { submits, touch, submit, shown: (key: K) => submits > 0 || touched.has(key) };
}
