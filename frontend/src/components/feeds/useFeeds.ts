import { useQuery } from "@tanstack/react-query";
import { BACKEND_URL, apiGet } from "@/lib/api";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { feedAddresses } from "@/lib/feeds";
import type { CalendarFeed, TargetGroup } from "@/lib/types";

/**
 * Feeds and audiences of a calendar (design: Feeds, FeedEdit), plus the addresses of a feed.
 * `withList: false` skips the feed list (the edit page loads its feed with the single GET).
 */
export function useFeeds(calendarId: string, { withList = true }: { withList?: boolean } = {}) {
  const feeds = useQuery<CalendarFeed[]>({
    queryKey: ["feeds", calendarId],
    queryFn: () => apiGet<CalendarFeed[]>(`/api/calendars/${calendarId}/feeds?includeSecret=1`),
    enabled: withList,
  });
  const groups = useQuery<TargetGroup[]>({
    queryKey: ["targetGroups", calendarId],
    queryFn: () => apiGet<TargetGroup[]>(`/api/calendars/${calendarId}/target-groups`),
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

/** One feed by the single GET; its key lies below ["feeds", calendarId], so list invalidations refresh it. */
export function useFeed(calendarId: string, feedId: string | undefined) {
  return useQuery<CalendarFeed>({
    queryKey: ["feeds", calendarId, "one", feedId],
    queryFn: () =>
      apiGet<CalendarFeed>(`/api/calendars/${calendarId}/feeds/${feedId}?includeSecret=1`),
    enabled: !!feedId,
  });
}
