// Public feed (no sign-in): loading, error kinds, derived values and addresses (pure + fetch).
import { API_URL } from "@/lib/apiUrl";
import { overlapsRange, type IsoDate } from "@/lib/calendar";
import { matchesGroups } from "@/lib/events/list";
import type { FeedVisibility } from "@/lib/types";
import { sortByName } from "@/lib/sortByName";

const API_BASE = API_URL;

export interface PublicFeedLocation {
  id: string;
  name?: string | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  updatedAt?: number;
}

/** An event as `GET /api/feed/{id}/events` delivers it (published events only). */
export interface PublicFeedEvent {
  id: string;
  name: string;
  date: string;
  dateEnd?: string | null;
  timeBegin: string;
  timeEnd: string;
  isAllDay?: boolean;
  timezone?: string | null;
  isDraft?: boolean;
  note?: string | null;
  location?: PublicFeedLocation | null;
  properties: { property: { id: string; name: string; icon: string | null } }[];
  features: { feature: { id: string; name: string } }[];
  targetGroups: { targetGroup: { id: string; name: string } }[];
}

/** Holidays of the calendar (same shape as `…/holiday-events`). */
export interface PublicHoliday {
  id: string;
  holidayCalendarId: string;
  name: string;
  date: string;
  dateEnd: string | null;
}

/** Page header of a feed (`feed` of both public endpoints). */
export interface PublicFeedHeader {
  id: string;
  name: string;
  clubName: string;
  /** Zone of the club: "today" and the time note. */
  timezone: string;
  visibility: FeedVisibility;
  /** Search engines may index the page (PUBLIC feed with the search engine option); else noindex. */
  indexable: boolean;
  /** Published events of the feed over all dates (the page loads one month at a time). */
  eventCount: number;
  /** Audiences of those events, sorted by name (filter chips, tag tones). */
  audiences: AudienceOption[];
}

export interface PublicFeedData {
  feed: PublicFeedHeader;
  events: PublicFeedEvent[];
  holidays: PublicHoliday[];
}

export interface PublicEventData {
  feed: PublicFeedHeader;
  event: PublicFeedEvent;
}

/** private = 403 (secret missing or wrong), notFound = 404 (unknown, archived calendar), error = rest. */
export type PublicFeedErrorKind = "private" | "notFound" | "error";

export class PublicFeedError extends Error {
  constructor(public readonly kind: PublicFeedErrorKind) {
    super(`public feed: ${kind}`);
  }
}

/** GET with no credentials; the secret travels only in the query to our own API. */
async function fetchPublic<T>(
  path: string,
  params: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`${API_BASE.replace(/\/+$/, "")}${path}`);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  let res: Response;
  try {
    // The page address (which carries the secret) never goes out as Referer.
    res = await fetch(url.toString(), { signal, referrerPolicy: "no-referrer" });
  } catch {
    throw new PublicFeedError("error");
  }
  if (res.status === 403) throw new PublicFeedError("private");
  if (res.status === 404) throw new PublicFeedError("notFound");
  if (!res.ok) throw new PublicFeedError("error");
  try {
    return (await res.json()) as T;
  } catch {
    throw new PublicFeedError("error");
  }
}

/**
 * Loads a feed, optionally only the events (and holidays) overlapping `range` (inclusive days).
 * Drafts are dropped again here although the API never delivers them.
 */
export async function fetchPublicFeed(
  feedId: string,
  secret: string | undefined,
  range?: { from: IsoDate; to: IsoDate },
  signal?: AbortSignal,
): Promise<PublicFeedData> {
  const data = await fetchPublic<PublicFeedData>(
    `/api/feed/${encodeURIComponent(feedId)}/events`,
    { secret, from: range?.from, to: range?.to },
    signal,
  );
  return {
    feed: { ...data.feed, audiences: sortByName(data.feed?.audiences ?? []) },
    events: (data.events ?? []).filter((ev) => !ev.isDraft),
    holidays: data.holidays ?? [],
  };
}

/** One published event of the feed (404 = unknown / draft / not in the feed, or unknown feed). */
export async function fetchPublicEvent(
  feedId: string,
  eventId: string,
  secret: string | undefined,
  signal?: AbortSignal,
): Promise<PublicEventData> {
  const data = await fetchPublic<PublicEventData>(
    `/api/feed/${encodeURIComponent(feedId)}/events/${encodeURIComponent(eventId)}`,
    { secret },
    signal,
  );
  if (!data.event || data.event.isDraft) throw new PublicFeedError("notFound");
  return {
    feed: { ...data.feed, audiences: sortByName(data.feed?.audiences ?? []) },
    event: data.event,
  };
}

/** The one-event ICS file rendered by the backend (same output as the feed). */
export async function fetchPublicEventIcs(
  feedId: string,
  eventId: string,
  secret: string | undefined,
): Promise<Blob> {
  const url = new URL(
    `${API_BASE.replace(/\/+$/, "")}/api/feed/${encodeURIComponent(feedId)}/events/${encodeURIComponent(eventId)}/ics`,
  );
  if (secret) url.searchParams.set("secret", secret);
  let res: Response;
  try {
    res = await fetch(url.toString(), { referrerPolicy: "no-referrer" });
  } catch {
    throw new PublicFeedError("error");
  }
  if (res.status === 403) throw new PublicFeedError("private");
  if (res.status === 404) throw new PublicFeedError("notFound");
  if (!res.ok) throw new PublicFeedError("error");
  return res.blob();
}

export interface AudienceOption {
  id: string;
  name: string;
}

/** Events of the selected audiences (no selection = all) whose name contains the query. */
export function filterPublicEvents<T extends PublicFeedEvent>(
  events: T[],
  groupIds: string[],
  query: string,
): T[] {
  const q = query.trim().toLocaleLowerCase();
  return events.filter(
    (ev) => matchesGroups(ev, groupIds) && (!q || ev.name.toLocaleLowerCase().includes(q)),
  );
}

/** The list view with a search term shows the matches of all dates, not one month. */
export function isSearchList(view: "month" | "list", query: string): boolean {
  return view === "list" && query.trim() !== "";
}

/** Events that overlap the range (first and last day, inclusive). */
export function eventsInRange<T extends PublicFeedEvent>(
  events: T[],
  from: IsoDate,
  to: IsoDate,
): T[] {
  return events.filter((ev) => {
    const start = ev.date.slice(0, 10);
    const end = ev.dateEnd ? ev.dateEnd.slice(0, 10) : start;
    return overlapsRange({ start, end: end < start ? start : end }, from, to);
  });
}

/** Ids from a comma separated URL value; only ids the feed knows survive. */
export function parseGroupIds(value: string | null | undefined, known: AudienceOption[]): string[] {
  if (!value) return [];
  const ids = new Set(known.map((g) => g.id));
  return value.split(",").filter((id, i, all) => ids.has(id) && all.indexOf(id) === i);
}

export interface PublicAddresses {
  /** ICS address for calendar apps. */
  ics: string;
  /** Same address with the webcal scheme. */
  webcal: string;
}

/** Subscribe addresses; they carry the secret (private feeds) and the chosen audiences. */
export function publicFeedAddresses(
  feedId: string,
  secret: string | undefined,
  groupIds: string[],
  apiUrl: string = API_BASE,
): PublicAddresses {
  const url = new URL(`${apiUrl.replace(/\/+$/, "")}/api/feed/${encodeURIComponent(feedId)}/ics`);
  if (secret) url.searchParams.set("secret", secret);
  if (groupIds.length > 0) url.searchParams.set("targetGroupIds", groupIds.join(","));
  const ics = url.toString();
  return { ics, webcal: ics.replace(/^https?:/, "webcal:") };
}

/** Google Calendar "add by URL" (subscribes to the webcal address). */
export function googleCalendarUrl(webcal: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
}

/** Outlook.com "add from web" (takes the https ICS address). */
export function outlookCalendarUrl(ics: string, name: string): string {
  return `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(ics)}&name=${encodeURIComponent(name)}`;
}

/** In-app address of the public feed; `secret` keeps private feeds reachable, `extra` adds view state. */
export function publicFeedPath(
  feedId: string,
  secret: string | undefined,
  extra: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  if (secret) params.set("secret", secret);
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  const query = params.toString();
  return `/feed/${encodeURIComponent(feedId)}${query ? `?${query}` : ""}`;
}

/**
 * In-app path (with the view state) kept in the router state for the way back from the event
 * page. The secret is left out: history state is not the place for it; `publicBackPath` adds it
 * again from the address.
 */
export function viewPathWithoutSecret(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("secret");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

/** The way back to the feed: the stored view (same feed only) plus the secret of the address. */
export function publicBackPath(
  feedId: string,
  secret: string | undefined,
  from: unknown,
  fallback: Record<string, string | undefined> = {},
): string {
  const base = `/feed/${encodeURIComponent(feedId)}`;
  if (typeof from === "string" && (from === base || from.startsWith(`${base}?`))) {
    const [pathname, search = ""] = from.split("?");
    const params = new URLSearchParams(search);
    params.delete("secret");
    if (secret) params.set("secret", secret);
    const query = params.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  }
  return publicFeedPath(feedId, secret, fallback);
}

export function publicEventPath(
  feedId: string,
  eventId: string,
  secret: string | undefined,
): string {
  const query = secret ? `?secret=${encodeURIComponent(secret)}` : "";
  return `/feed/${encodeURIComponent(feedId)}/events/${encodeURIComponent(eventId)}${query}`;
}

/** Link target for a map app: coordinates if known, else the address text; never the secret. */
export function mapLinkFor(
  loc: Pick<PublicFeedLocation, "latitude" | "longitude">,
  addressText: string,
): string | null {
  if (loc.latitude != null && loc.longitude != null) {
    return `https://www.openstreetmap.org/?mlat=${loc.latitude}&mlon=${loc.longitude}#map=16/${loc.latitude}/${loc.longitude}`;
  }
  return addressText
    ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(addressText)}`
    : null;
}
