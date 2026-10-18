import { useQuery } from "@tanstack/react-query";
import { BACKEND_URL, apiGet } from "@/lib/api";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { feedAddresses } from "@/lib/feeds";
import type { CalendarFeed, TargetGroup } from "@/lib/types";

/**
 * Feeds and audiences of a club (design: Feeds, FeedEdit), plus the addresses of a feed.
 * `withList: false` skips the feed list (the edit page loads its feed with the single GET).
 */
export function useFeeds(clubId: string, { withList = true }: { withList?: boolean } = {}) {
  const feeds = useQuery<CalendarFeed[]>({
    queryKey: ["feeds", clubId],
    queryFn: () => apiGet<CalendarFeed[]>(`/api/clubs/${clubId}/feeds?includeSecret=1`),
    enabled: withList,
  });
  const groups = useQuery<TargetGroup[]>({
    queryKey: ["targetGroups", clubId],
    queryFn: () => apiGet<TargetGroup[]>(`/api/clubs/${clubId}/target-groups`),
  });
  const groupList = groups.data ?? [];
  return {
    feeds,
    groups,
    groupList,
    /** Audience tag tone: by position in the audience list, like everywhere else. */
    toneOf: (id: string) => audienceTone(groupList.findIndex((g) => g.id === id)),
    nameOf: (id: string) => groupList.find((g) => g.id === id)?.name,
    addresses: (feed: CalendarFeed) => feedAddresses(feed, BACKEND_URL, window.location.origin),
  };
}

/** One feed by the single GET; its key lies below ["feeds", clubId], so list invalidations refresh it. */
export function useFeed(clubId: string, feedId: string | undefined) {
  return useQuery<CalendarFeed>({
    queryKey: ["feeds", clubId, "one", feedId],
    queryFn: () => apiGet<CalendarFeed>(`/api/clubs/${clubId}/feeds/${feedId}?includeSecret=1`),
    enabled: !!feedId,
  });
}
