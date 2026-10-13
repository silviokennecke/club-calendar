import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import type { SeriesPreviewResponse, SeriesRule } from "@/lib/events";

/** Wait after the last change of the rule before the preview runs again. */
export const SERIES_PREVIEW_DELAY_MS = 300;

/**
 * The backend's dates of a series rule (`POST …/events/series/preview`, writes nothing), debounced.
 * `pending` while the rule changed and the new answer is not there yet (the previous answer stays
 * visible meanwhile); errors as `error` (e.g. 422 `too_many_events`).
 */
export function useSeriesPreview(calendarId: string, rule: SeriesRule | null, enabled: boolean) {
  const key = rule ? JSON.stringify(rule) : null;
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(key), SERIES_PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);

  const query = useQuery<SeriesPreviewResponse>({
    queryKey: ["seriesPreview", calendarId, debounced],
    queryFn: () =>
      apiPost<SeriesPreviewResponse>(`/api/calendars/${calendarId}/events/series/preview`, {
        rule: JSON.parse(debounced as string) as SeriesRule,
      }),
    enabled: enabled && debounced !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const settled = key === debounced && !query.isFetching;
  return {
    data: key ? query.data : undefined,
    pending: enabled && key !== null && !settled,
    error: settled ? query.error : null,
    retry: () => void query.refetch(),
  };
}
