// Pure feed logic (no React): addresses, visibility, form values and payload.
import type { CalendarFeed } from "@/lib/types";

export type FeedVisibility = CalendarFeed["visibility"];

export interface FeedAddresses {
  /** Subscribe address for calendar apps (ICS). */
  ics: string;
  /** Same address with the webcal scheme: opens the calendar app directly. */
  webcal: string;
  /** Web page without sign-in (route `/feed/:id`). */
  web: string;
}

/**
 * The three addresses of a feed. Private feeds carry their secret in every address
 * (`?secret=`), public feeds never do.
 */
export function feedAddresses(
  feed: Pick<CalendarFeed, "id" | "visibility" | "sharedSecret">,
  apiUrl: string,
  origin: string,
): FeedAddresses {
  const query =
    feed.visibility === "PRIVATE" ? `?secret=${encodeURIComponent(feed.sharedSecret)}` : "";
  const ics = `${apiUrl.replace(/\/+$/, "")}/api/feed/${feed.id}/ics${query}`;
  return {
    ics,
    webcal: ics.replace(/^https?:/, "webcal:"),
    web: `${origin.replace(/\/+$/, "")}/feed/${feed.id}${query}`,
  };
}

/** Ids of the audiences a feed is limited to (empty = all audiences). */
export function feedAudienceIds(feed: Pick<CalendarFeed, "targetGroups">): string[] {
  return feed.targetGroups.map((g) => g.targetGroupId);
}

export interface FeedFormValues {
  name: string;
  visibility: FeedVisibility;
  targetGroupIds: string[];
}

export function emptyFeedValues(): FeedFormValues {
  return { name: "", visibility: "PUBLIC", targetGroupIds: [] };
}

export function feedValuesFromRecord(feed: CalendarFeed): FeedFormValues {
  return {
    name: feed.name,
    visibility: feed.visibility,
    targetGroupIds: feedAudienceIds(feed),
  };
}

export function isFeedDirty(initial: FeedFormValues, values: FeedFormValues): boolean {
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));
  return (
    initial.name.trim() !== values.name.trim() ||
    initial.visibility !== values.visibility ||
    !same(initial.targetGroupIds, values.targetGroupIds)
  );
}

export type FeedProblem = "nameEmpty";

export function validateFeed(values: FeedFormValues): FeedProblem[] {
  return values.name.trim() ? [] : ["nameEmpty"];
}

export function toFeedPayload(values: FeedFormValues) {
  return {
    name: values.name.trim(),
    visibility: values.visibility,
    targetGroupIds: values.targetGroupIds,
  };
}

/** Toggles an audience in the selection. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
