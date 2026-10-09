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
  /** Events / feeds of all calendars (only `GET /api/clubs/:id`, for the delete dialog). */
  eventCount?: number;
  feedCount?: number;
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
  feedCount?: number;
}

export interface CalendarFeed {
  id: string;
  calendarid: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
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
  calendarid: string;
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
  calendarid: string;
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
  properties: { property: Property }[];
  features: { feature: Feature }[];
  targetGroups: { targetGroup: TargetGroup }[];
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
