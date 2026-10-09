import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IsoDate } from "@/lib/calendar";
import {
  fetchPublicEvent,
  fetchPublicFeed,
  PublicFeedError,
  type PublicEventData,
  type PublicFeedData,
  type PublicFeedErrorKind,
} from "@/lib/feeds/public";

function errorKindOf(isError: boolean, error: unknown): PublicFeedErrorKind | null {
  if (!isError) return null;
  return error instanceof PublicFeedError ? error.kind : "error";
}

/**
 * The public feed of `/feed/:feedId` for the visible days (`range`, overlap). The previous month stays
 * visible while the next one loads. No retries: errors are states with their own "Erneut versuchen".
 */
export function usePublicFeed(
  feedId: string | undefined,
  secret: string | undefined,
  range?: { from: IsoDate; to: IsoDate },
) {
  const query = useQuery({
    queryKey: ["publicFeed", feedId, secret ?? null, range?.from ?? null, range?.to ?? null],
    queryFn: ({ signal }) => fetchPublicFeed(feedId!, secret, range, signal),
    enabled: !!feedId,
    retry: false,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  return { ...query, errorKind: errorKindOf(query.isError, query.error) };
}

/**
 * One event of the feed by the single-event endpoint (shared links of the event dialog). Opened from
 * the feed page, the event already loaded there is shown until the answer arrives (no skeleton).
 */
export function usePublicEvent(
  feedId: string | undefined,
  eventId: string | undefined,
  secret: string | undefined,
) {
  const qc = useQueryClient();
  const query = useQuery<PublicEventData>({
    queryKey: ["publicEvent", feedId, eventId, secret ?? null],
    queryFn: ({ signal }) => fetchPublicEvent(feedId!, eventId!, secret, signal),
    enabled: !!feedId && !!eventId,
    retry: false,
    staleTime: 60_000,
    placeholderData: () => {
      const cached = qc.getQueriesData<PublicFeedData>({
        queryKey: ["publicFeed", feedId, secret ?? null],
      });
      for (const [, data] of cached) {
        const event = data?.events.find((ev) => ev.id === eventId);
        if (data && event) return { feed: data.feed, event };
      }
      return undefined;
    },
  });
  return { ...query, errorKind: errorKindOf(query.isError, query.error) };
}
