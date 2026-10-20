import { useCallback, useState } from "react";

/**
 * Tracks which fields were left (blur) and how often the form was submitted: errors show for a
 * touched field or after the first submit, never while typing into a fresh field. `submits` doubles
 * as ErrorSummary `focusSignal`.
 */
export function useFieldTouch<K extends string>() {
  const [touched, setTouched] = useState<ReadonlySet<K>>(new Set());
  const [submits, setSubmits] = useState(0);
  const touch = useCallback(
    (key: K) => setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key))),
    [],
  );
  const submit = useCallback(() => setSubmits((n) => n + 1), []);
  return { submits, touch, submit, shown: (key: K) => submits > 0 || touched.has(key) };
}
