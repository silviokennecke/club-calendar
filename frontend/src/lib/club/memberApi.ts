// Member endpoints: the personal subscription, its calendar view and feed claim / membership.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL } from "@/lib/apiUrl";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import type { PublicAddresses, PublicEventData, PublicFeedData } from "@/lib/feeds/public";
import type {
  FeedClaimResult,
  FeedMembership,
  MemberSubscription,
  MyFeedsResponse,
} from "@/lib/types";

export const mySubscriptionKey = (clubId: string) => ["my-subscription", clubId] as const;
export const myFeedsKey = (clubId: string) => ["my-feeds", clubId] as const;
export const myEventsKey = (clubId: string, params?: MyEventsParams) =>
  ["my-events", clubId, params ?? {}] as const;

export interface MyEventsParams {
  from?: string;
  to?: string;
  /** Present (also empty) overrides the subscription's audiences; undefined = the subscription's own. */
  targetGroupIds?: string[];
}

export const getMySubscription = (clubId: string) =>
  apiGet<MemberSubscription>(`/api/clubs/${clubId}/my-subscription`);

export const replaceMySubscription = (
  clubId: string,
  body: { feedIds: string[]; targetGroupIds: string[] },
) => apiPut<MemberSubscription>(`/api/clubs/${clubId}/my-subscription`, body);

export const rotateMySubscriptionSecret = (clubId: string) =>
  apiPost<MemberSubscription>(`/api/clubs/${clubId}/my-subscription/rotate-secret`, {});

export const getMyFeeds = (clubId: string) =>
  apiGet<MyFeedsResponse>(`/api/clubs/${clubId}/my-feeds`);

export function getMyEvents(clubId: string, params: MyEventsParams = {}): Promise<PublicFeedData> {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.targetGroupIds) query.set("targetGroupIds", params.targetGroupIds.join(","));
  const qs = query.toString();
  return apiGet<PublicFeedData>(`/api/clubs/${clubId}/my-events${qs ? `?${qs}` : ""}`);
}

export const getMyEvent = (clubId: string, eventId: string) =>
  apiGet<PublicEventData>(`/api/clubs/${clubId}/my-events/${encodeURIComponent(eventId)}`);

export const claimFeed = (feedId: string, secret?: string) =>
  apiPost<FeedClaimResult>(
    `/api/feed/${encodeURIComponent(feedId)}/claim`,
    secret ? { secret } : {},
  );

export const getFeedMembership = (feedId: string, secret?: string) =>
  apiGet<FeedMembership>(
    `/api/feed/${encodeURIComponent(feedId)}/membership${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`,
  );

/** Personal subscription address (ICS and webcal); the secret is the only credential. */
export function mySubscriptionAddresses(
  subscription: Pick<MemberSubscription, "id" | "secret">,
  apiUrl: string = API_URL,
): PublicAddresses {
  const url = new URL(
    `${apiUrl.replace(/\/+$/, "")}/api/feed/me/${encodeURIComponent(subscription.id)}/ics`,
  );
  url.searchParams.set("secret", subscription.secret);
  const ics = url.toString();
  return { ics, webcal: ics.replace(/^https?:/, "webcal:") };
}

/** The own subscription; created by the server on the first call. */
export function useMySubscription(clubId: string | undefined) {
  return useQuery({
    queryKey: mySubscriptionKey(clubId ?? ""),
    queryFn: () => getMySubscription(clubId!),
    enabled: !!clubId,
    retry: false,
  });
}

export function useMyFeeds(clubId: string | undefined) {
  return useQuery({
    queryKey: myFeedsKey(clubId ?? ""),
    queryFn: () => getMyFeeds(clubId!),
    enabled: !!clubId,
    retry: false,
  });
}

export function useMyEvents(clubId: string | undefined, params: MyEventsParams = {}) {
  return useQuery({
    queryKey: myEventsKey(clubId ?? "", params),
    queryFn: () => getMyEvents(clubId!, params),
    enabled: !!clubId,
    retry: false,
  });
}

export function useMyEvent(clubId: string | undefined, eventId: string | undefined) {
  return useQuery({
    queryKey: ["my-event", clubId ?? "", eventId ?? ""],
    queryFn: () => getMyEvent(clubId!, eventId!),
    enabled: !!clubId && !!eventId,
    retry: false,
  });
}

/** A changed selection or secret changes the feeds list ("selected") and the calendar view. */
function useInvalidateMyClub(clubId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: myFeedsKey(clubId) }),
      qc.invalidateQueries({ queryKey: ["my-events", clubId] }),
    ]);
}

export function useReplaceMySubscription(clubId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMyClub(clubId);
  return useMutation({
    mutationFn: (body: { feedIds: string[]; targetGroupIds: string[] }) =>
      replaceMySubscription(clubId, body),
    onSuccess: async (subscription) => {
      qc.setQueryData(mySubscriptionKey(clubId), subscription);
      await invalidate();
    },
  });
}

export function useRotateMySubscriptionSecret(clubId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => rotateMySubscriptionSecret(clubId),
    onSuccess: (subscription) => qc.setQueryData(mySubscriptionKey(clubId), subscription),
  });
}

export function useClaimFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ feedId, secret }: { feedId: string; secret?: string }) =>
      claimFeed(feedId, secret),
    onSuccess: async (result) => {
      // A new membership changes the club list; new access changes the selectable feeds.
      await qc.invalidateQueries({ queryKey: ["clubs"] });
      await qc.invalidateQueries({ queryKey: myFeedsKey(result.clubId) });
    },
  });
}

export function useFeedMembership(feedId: string | undefined, secret?: string, enabled = true) {
  return useQuery({
    queryKey: ["feed-membership", feedId ?? "", secret ?? ""],
    queryFn: () => getFeedMembership(feedId!, secret),
    enabled: !!feedId && enabled,
    retry: false,
  });
}
