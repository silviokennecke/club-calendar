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
  /** Subscribe address for calendar apps (ICS). */
  ics: string;
  /** Same address with the webcal scheme: opens the calendar app directly. */
  webcal: string;
  /** Web page without sign-in (route `/feed/:id`). */
  web: string;
}

/**
 * The three addresses of a feed. Private feeds carry their secret in every address
 * (`?secret=`), public and club feeds never do.
 */
export function feedAddresses(
  feed: Pick<CalendarFeed, "id" | "visibility" | "sharedSecret">,
  apiUrl: string,
  origin: string,
): FeedAddresses {
  const query = requiresSecret(feed.visibility)
    ? `?secret=${encodeURIComponent(feed.sharedSecret)}`
    : "";
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
  /** Search engine opt-in; only effective (and only sent as true) for PUBLIC. */
  searchable: boolean;
  targetGroupIds: string[];
}

/** New feeds are CLUB ("Vereinsintern"), not searchable. */
export function emptyFeedValues(): FeedFormValues {
  return { name: "", visibility: "CLUB", searchable: false, targetGroupIds: [] };
}

export function feedValuesFromRecord(feed: CalendarFeed): FeedFormValues {
  return {
    name: feed.name,
    visibility: feed.visibility,
    searchable: feed.visibility === "PUBLIC" && feed.searchable === true,
    targetGroupIds: feedAudienceIds(feed),
  };
}

/** The search engine option as it will be saved: only PUBLIC feeds keep it. */
export function effectiveSearchable(values: Pick<FeedFormValues, "visibility" | "searchable">) {
  return values.visibility === "PUBLIC" && values.searchable;
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
    effectiveSearchable(initial) !== effectiveSearchable(values) ||
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
    searchable: effectiveSearchable(values),
    targetGroupIds: values.targetGroupIds,
  };
}

/** Toggles an audience in the selection. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
