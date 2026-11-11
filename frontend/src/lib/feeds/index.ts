// Pure feed logic (no React): addresses, visibility, form values and payload.
import type { CalendarFeed, FeedVisibility } from "@/lib/types";

export type { FeedVisibility };

/** Badge of a feed status (word + icon): PUBLIC "public", CLUB "club", PRIVATE "private". */
export function feedStatus(visibility: FeedVisibility): "public" | "club" | "private" {
  return visibility === "PRIVATE" ? "private" : visibility === "CLUB" ? "club" : "public";
}

/** Only PRIVATE feeds need the secret; PUBLIC and CLUB are reachable by link. */
export function requiresSecret(visibility: FeedVisibility): boolean {
  return visibility === "PRIVATE";
}

export interface FeedAddresses {
  /** Web page without sign-in (route `/feed/:id`). */
  web: string;
}

/**
 * The address of a feed. Private feeds carry their secret in it (`?secret=`), public and club
 * feeds never do.
 */
export function feedAddresses(
  feed: Pick<CalendarFeed, "id" | "visibility" | "sharedSecret">,
  origin: string,
): FeedAddresses {
  const query = requiresSecret(feed.visibility)
    ? `?secret=${encodeURIComponent(feed.sharedSecret)}`
    : "";
  return { web: `${origin.replace(/\/+$/, "")}/feed/${feed.id}${query}` };
}

/** Ids of the audiences a feed is limited to (empty = all audiences). */
export function feedAudienceIds(feed: Pick<CalendarFeed, "targetGroups">): string[] {
  return feed.targetGroups.map((g) => g.targetGroupId);
}

export interface FeedFormValues {
  name: string;
  visibility: FeedVisibility;
  /** Calendars the feed publishes (at least one). */
  calendarIds: string[];
  targetGroupIds: string[];
}

/** New feeds are CLUB ("Vereinsintern"). */
export function emptyFeedValues(calendarIds: string[] = []): FeedFormValues {
  return { name: "", visibility: "CLUB", calendarIds, targetGroupIds: [] };
}

export function feedValuesFromRecord(feed: CalendarFeed): FeedFormValues {
  return {
    name: feed.name,
    visibility: feed.visibility,
    calendarIds: feed.calendarIds ?? [],
    targetGroupIds: feedAudienceIds(feed),
  };
}

/**
 * Saving drops the secret requirement: a saved PRIVATE feed becomes PUBLIC or CLUB (then anyone
 * with the link can see it). Asks for confirmation first.
 */
export function dropsSecret(
  saved: Pick<CalendarFeed, "visibility"> | undefined,
  values: Pick<FeedFormValues, "visibility">,
): boolean {
  return !!saved && requiresSecret(saved.visibility) && !requiresSecret(values.visibility);
}

export function isFeedDirty(initial: FeedFormValues, values: FeedFormValues): boolean {
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));
  return (
    initial.name.trim() !== values.name.trim() ||
    initial.visibility !== values.visibility ||
    !same(initial.calendarIds, values.calendarIds) ||
    !same(initial.targetGroupIds, values.targetGroupIds)
  );
}

export type FeedProblem = "nameEmpty" | "noCalendar";

export function validateFeed(values: FeedFormValues): FeedProblem[] {
  const problems: FeedProblem[] = [];
  if (!values.name.trim()) problems.push("nameEmpty");
  if (values.calendarIds.length === 0) problems.push("noCalendar");
  return problems;
}

export function toFeedPayload(values: FeedFormValues) {
  return {
    name: values.name.trim(),
    visibility: values.visibility,
    calendarIds: values.calendarIds,
    targetGroupIds: values.targetGroupIds,
  };
}

/** Toggles an audience in the selection. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
