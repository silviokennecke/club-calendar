import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost } from "@/lib/api";
import {
  IMPORT_MAX,
  checkFromPreview,
  toImportRequest,
  type ImportCheck,
  type ImportItem,
} from "@/lib/import";
import type { ImportPreviewResponse, Location } from "@/lib/types";

/** Wait after the last edit before the preview runs again. */
const PREVIEW_DELAY_MS = 300;

export type PreviewState =
  /** First answer pending. */
  | { status: "loading"; check: null }
  /** `check` is the backend's verdict; `stale` while a newer request (after an edit) runs. */
  | { status: "ready"; check: ImportCheck; stale: boolean }
  /** The preview failed (or the file is too large for one request): fall back to the browser check. */
  | { status: "failed"; check: null };

/**
 * The backend's dry run of the import (`POST …/events/import/preview`) for all items of the file:
 * duplicates (ICS UID or name + day), entries it would reject, and warnings such as replaced time
 * zones. Reruns (debounced) when anything the request depends on changes, not for selection changes.
 */
export function useImportPreview(
  calendarId: string,
  items: ImportItem[],
  locations: Location[],
  enabled: boolean,
): PreviewState {
  // Selection changes do not change the request body: the effect compares the serialized body.
  const request = useMemo(() => {
    const body = toImportRequest(items, locations);
    return { body, key: JSON.stringify(body) };
  }, [items, locations]);
  const [state, setState] = useState<PreviewState>({ status: "loading", check: null });
  const lastKey = useRef<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled || items.length === 0) return;
    if (request.key === lastKey.current) return;
    if (items.length > IMPORT_MAX) {
      lastKey.current = request.key;
      setState({ status: "failed", check: null });
      return;
    }
    const id = ++seq.current;
    setState((prev) => (prev.status === "ready" ? { ...prev, stale: true } : prev));
    const timer = setTimeout(() => {
      lastKey.current = request.key;
      apiPost<ImportPreviewResponse>(
        `/api/calendars/${calendarId}/events/import/preview`,
        request.body,
      )
        .then((res) => {
          if (id !== seq.current) return;
          // Entries come back by index, in the order of the request (= the items' order)
          const check = checkFromPreview(items, res.events, res.warnings);
          setState({ status: "ready", check, stale: false });
        })
        .catch(() => {
          if (id === seq.current) setState({ status: "failed", check: null });
        });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [calendarId, enabled, items, request]);

  return state;
}
