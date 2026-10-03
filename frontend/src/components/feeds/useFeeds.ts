import { useQuery } from "@tanstack/react-query";
import { BACKEND_URL, apiGet } from "@/lib/api";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { feedAddresses } from "@/lib/feeds";
import type { CalendarFeed, TargetGroup } from "@/lib/types";

/** Feeds and audiences of a calendar (design: Feeds, FeedEdit), plus the addresses of a feed. */
export function useFeeds(calendarId: string) {
  const feeds = useQuery<CalendarFeed[]>({
    queryKey: ["feeds", calendarId],
    queryFn: () => apiGet<CalendarFeed[]>(`/api/calendars/${calendarId}/feeds`),
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
