import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import type { SeriesPreviewResponse, SeriesRule, SeriesUpdatePreview } from "@/lib/events";

/** Wait after the last change of the rule before the preview runs again. */
export const SERIES_PREVIEW_DELAY_MS = 300;

/**
 * A server preview of a rule (writes nothing), debounced. `pending` while the rule changed and the
 * new answer is not there yet (the previous answer stays visible meanwhile); errors as `error`
 * (e.g. 422 `too_many_events`).
 */
function useRulePreview<T>(
  key: readonly unknown[],
  path: string,
  rule: SeriesRule | null,
  enabled: boolean,
) {
  const ruleKey = rule ? JSON.stringify(rule) : null;
  const [debounced, setDebounced] = useState(ruleKey);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(ruleKey), SERIES_PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ruleKey]);

  const query = useQuery<T>({
    queryKey: [...key, debounced],
    queryFn: () => apiPost<T>(path, { rule: JSON.parse(debounced as string) as SeriesRule }),
    enabled: enabled && debounced !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    // An error (e.g. 422 too_many_events, server down) shows at once; "Erneut versuchen" is the retry.
    retry: false,
  });

  const settled = ruleKey === debounced && !query.isFetching;
  return {
    data: ruleKey ? query.data : undefined,
    pending: enabled && ruleKey !== null && !settled,
    error: settled ? query.error : null,
    retry: () => void query.refetch(),
  };
}

/** The backend's dates of a new series rule (`POST …/events/series/preview`). */
export function useSeriesPreview(calendarId: string, rule: SeriesRule | null, enabled: boolean) {
  return useRulePreview<SeriesPreviewResponse>(
    ["seriesPreview", calendarId],
    `/api/calendars/${calendarId}/events/series/preview`,
    rule,
    enabled,
  );
}

/**
 * What changing the rule of an existing series would do now (`POST …/event-series/{id}/
 * preview-update`): new dates, events to delete, unchanged and past events.
 */
export function useSeriesUpdatePreview(
  calendarId: string,
  seriesId: string,
  rule: SeriesRule | null,
  enabled: boolean,
) {
  return useRulePreview<SeriesUpdatePreview>(
    ["seriesUpdatePreview", calendarId, seriesId],
    `/api/calendars/${calendarId}/event-series/${seriesId}/preview-update`,
    rule,
    enabled,
  );
}
