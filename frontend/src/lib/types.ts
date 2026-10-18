import type { EventSeriesInfo } from "@/lib/events/series";

/** Club role, ascending rights: viewer < editor < admin. */
export type ClubRole = "viewer" | "editor" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  dateFormat: string;
  firstDayOfWeek: number;
  lastClubId?: string | null;
  lastCalendarId?: string | null;
  language: string;
}

export interface Club {
  id: string;
  name: string;
  timezone: string;
  /** Active calendars (`GET /api/clubs` and `GET /api/clubs/:id`). */
  calendarCount?: number;
  archivedCalendarCount?: number;
  memberCount?: number;
  /** The signed-in user's role in this club (`GET /api/clubs`, `GET /api/clubs/:id`). */
  role?: ClubRole;
  /** The caller's last opened calendar in this club (`GET /api/clubs`; null if none or deleted). */
  lastCalendarId?: string | null;
  /** Events / feeds of all calendars (only `GET /api/clubs/:id`, for the delete dialog). */
  eventCount?: number;
  feedCount?: number;
}

/** Member of a club (`GET /api/clubs/:id/members`). */
export interface ClubMember extends User {
  role: ClubRole;
}

export interface Calendar {
  id: string;
  clubId: string;
  name: string;
  timezone?: string | null;
  archivedAt?: string | null;
  /** Counters of the calendar list and the single GET. */
  eventCount?: number;
  templateCount?: number;
  /** Feeds that select this calendar. */
  feedCount?: number;
  /** Feeds that exist only for this calendar (deleted with it). */
  exclusiveFeedCount?: number;
}

export type FeedVisibility = "PUBLIC" | "CLUB" | "PRIVATE";

export interface CalendarFeed {
  id: string;
  clubId: string;
  /** Calendars the feed publishes (at least one, all of the feed's club). */
  calendarIds: string[];
  name: string;
  /**
   * PUBLIC and CLUB ("Nur per Link"): reachable by link without the secret; they differ only in
   * the search engine instruction. PRIVATE: only with the secret.
   */
  visibility: FeedVisibility;
  /** Search engine opt-in; only ever true for PUBLIC feeds (the API resets it otherwise). */
  searchable: boolean;
  /** Search engines may index the feed (PUBLIC and searchable). */
  indexable: boolean;
  /** Only present when requested with `?includeSecret=1`; the feed screens always request it. */
  sharedSecret: string;
  targetGroups: { feedId: string; targetGroupId: string }[];
}

/**
 * What deleting a property / feature / audience detaches it from (list endpoints only).
 * `eventNames`: distinct names of the affected events when at most 3 events are affected, else [].
 */
export interface ReferenceUsage {
  events: number;
  templates: number;
  /** Audiences only: feeds that selected the audience. */
  feeds?: number;
  eventNames: string[];
}

export interface Property {
  id: string;
  calendarid: string;
  name: string;
  icon: string | null;
  usage?: ReferenceUsage;
}

export interface Feature {
  id: string;
  calendarid: string;
  name: string;
  usage?: ReferenceUsage;
}

export interface TargetGroup {
  id: string;
  clubId: string;
  name: string;
  usage?: ReferenceUsage;
}

/** Events and templates at a place; `templateNames` when at most 3 templates use it, else []. */
export interface LocationUsage {
  events: number;
  templates: number;
  templateNames: string[];
}

export interface Location {
  id: string;
  clubId: string;
  name?: string | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** List endpoint only. */
  usage?: LocationUsage;
}

export function formatAddress(loc: Pick<Location, "street" | "zip" | "city" | "country">): string {
  const parts: string[] = [];
  if (loc.street) parts.push(loc.street);
  const cityPart = [loc.zip, loc.city].filter(Boolean).join(" ");
  if (cityPart) parts.push(cityPart);
  if (loc.country) parts.push(loc.country);
  return parts.join(", ");
}

export interface EventTemplate {
  id: string;
  calendarId: string;
  name: string;
  /** null: the calendar's (else the club's) zone. */
  timezone: string | null;
  /** Both null: events from the template are all-day unless times are given when creating them. */
  timeBegin: string | null;
  timeEnd: string | null;
  locationId: string | null;
  location: Location | null;
  properties: { property: Property }[];
  features: { feature: Feature }[];
  targetGroups: { targetGroup: TargetGroup }[];
  /** Events created from this template (list and single GET). */
  eventCount?: number;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  name: string;
  date: string;
  dateEnd?: string | null; // YYYY-MM-DD, null/undefined = same day as date
  timeBegin: string;
  timeEnd: string;
  isAllDay?: boolean; // default false
  timezone: string | null;
  isDraft: boolean;
  locationId: string | null;
  location: Location | null;
  /** Template the event was created from (null for manual events). */
  eventTemplateId?: string | null;
  /** UID of the ICS event it was imported from (null for events created in the app). */
  externalUid?: string | null;
  /** Series the event belongs to (null for single events); lists and the single GET. */
  seriesId?: string | null;
  /** Rule and size of the series; only in the single GET (`…/events/:id`). */
  series?: EventSeriesInfo | null;
  properties: { property: Property }[];
  features: { feature: Feature }[];
  targetGroups: { targetGroup: TargetGroup }[];
}

/** `POST …/events/bulk` (atomic: all events or none). */
export type BulkAction = "publish" | "draft" | "delete";

/** Warning of the import (e.g. an unknown time zone of the file replaced by the calendar's zone). */
export interface ImportWarning {
  /** Index of the entry in the request's `events`. */
  index: number;
  field: string;
  code: "timezone_replaced" | (string & {});
  message: string;
  value?: string;
  replacement?: string | null;
}

/** One entry of `POST …/events/import/preview`. */
export type ImportPreviewEntry =
  | { index: number; status: "new" }
  | {
      index: number;
      status: "duplicate";
      /** The event the calendar already has; rule = same ICS UID or same name and day. */
      duplicate: { id: string; name: string; date: string; rule: "externalUid" | "nameDate" };
    }
  | {
      index: number;
      status: "invalid";
      errors: { field: string; code: string; message: string }[];
    };

export interface ImportPreviewResponse {
  events: ImportPreviewEntry[];
  summary: { total: number; new: number; duplicate: number; invalid: number };
  warnings: ImportWarning[];
}

/** `POST …/events/import` (one transaction: all or nothing). */
export interface ImportResponse {
  imported: number;
  skipped: number;
  createdLocations: { tempId: string; id: string }[];
  ids: string[];
  warnings: ImportWarning[];
}

export interface HolidayCalendar {
  id: string;
  name: string;
  url: string;
  lastFetchedAt: string | null;
  eventCount: number;
}

export interface HolidayEvent {
  id: string;
  holidayCalendarId: string;
  name: string;
  date: string; // YYYY-MM-DD, start (inclusive)
  dateEnd: string | null; // YYYY-MM-DD, end (inclusive), null = same day as date
}
