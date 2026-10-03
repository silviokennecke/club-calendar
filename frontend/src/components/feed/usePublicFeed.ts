import { useQuery } from "@tanstack/react-query";
import { fetchPublicFeed, PublicFeedError, type PublicFeedErrorKind } from "@/lib/feeds/public";

/**
 * The public feed of `/feed/:feedId` (shared by the calendar and the event page through the
 * query cache). No retries: errors are states with their own "Erneut versuchen" button.
 */
export function usePublicFeed(feedId: string | undefined, secret: string | undefined) {
  const query = useQuery({
    queryKey: ["publicFeed", feedId, secret ?? null],
    queryFn: ({ signal }) => fetchPublicFeed(feedId!, secret, signal),
    enabled: !!feedId,
    retry: false,
    staleTime: 60_000,
  });
  const errorKind: PublicFeedErrorKind | null = query.isError
    ? query.error instanceof PublicFeedError
      ? query.error.kind
      : "error"
    : null;
  return { ...query, errorKind };
}
