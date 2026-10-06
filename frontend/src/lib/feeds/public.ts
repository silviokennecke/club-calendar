// Public feed (no sign-in): loading, error kinds, derived values and addresses (pure + fetch).
import { overlapsRange, type IsoDate } from "@/lib/calendar";
import { matchesGroups } from "@/lib/events/list";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

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
  location?: PublicFeedLocation | null;
  properties: { property: { id: string; name: string; icon: string | null } }[];
  features: { feature: { id: string; name: string } }[];
  targetGroups: { targetGroup: { id: string; name: string } }[];
}

export interface PublicFeedData {
  feed: { id: string; name: string };
  events: PublicFeedEvent[];
}

/** private = 403 (secret missing or wrong), notFound = 404 (unknown, archived calendar), error = rest. */
export type PublicFeedErrorKind = "private" | "notFound" | "error";

export class PublicFeedError extends Error {
  constructor(public readonly kind: PublicFeedErrorKind) {
    super(`public feed: ${kind}`);
  }
}

/**
 * Loads a feed without any credentials. The secret travels only in the query to our own API;
 * `referrerPolicy: "no-referrer"` keeps the page address (which carries the secret) out of it.
 * Drafts are dropped again here although the API never delivers them.
 */
export async function fetchPublicFeed(
  feedId: string,
  secret: string | undefined,
  signal?: AbortSignal,
): Promise<PublicFeedData> {
  const url = new URL(
    `${API_BASE.replace(/\/+$/, "")}/api/feed/${encodeURIComponent(feedId)}/events`,
  );
  if (secret) url.searchParams.set("secret", secret);
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal, referrerPolicy: "no-referrer" });
  } catch {
    throw new PublicFeedError("error");
  }
  if (res.status === 403) throw new PublicFeedError("private");
  if (res.status === 404) throw new PublicFeedError("notFound");
  if (!res.ok) throw new PublicFeedError("error");
  try {
    const data = (await res.json()) as PublicFeedData;
    return { feed: data.feed, events: (data.events ?? []).filter((ev) => !ev.isDraft) };
  } catch {
    throw new PublicFeedError("error");
  }
}

/**
 * The time zone "today" and the time note refer to. The feed endpoint delivers no calendar
 * zone, so the most frequent zone of the events is used (null: fall back to the browser).
 */
export function feedTimeZone(events: Pick<PublicFeedEvent, "timezone">[]): string | null {
  const counts = new Map<string, number>();
  for (const ev of events) {
    if (ev.timezone) counts.set(ev.timezone, (counts.get(ev.timezone) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  for (const [zone, n] of counts) {
    if (n > max) {
      best = zone;
      max = n;
    }
  }
  return best;
}

export interface AudienceOption {
  id: string;
  name: string;
}

/** Target groups used by at least one event, sorted by name. */
export function feedAudiences(events: Pick<PublicFeedEvent, "targetGroups">[]): AudienceOption[] {
  const map = new Map<string, string>();
  for (const ev of events) {
    for (const { targetGroup } of ev.targetGroups) map.set(targetGroup.id, targetGroup.name);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

export function findPublicEvent<T extends PublicFeedEvent>(
  events: T[],
  eventId: string | undefined,
): T | undefined {
  return eventId ? events.find((ev) => String(ev.id) === eventId) : undefined;
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
