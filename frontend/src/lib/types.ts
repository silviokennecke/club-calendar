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
}

export interface Calendar {
  id: string;
  clubid: string;
  name: string;
  timezone?: string | null;
  archivedAt?: string | null; // add this line
}

export interface CalendarFeed {
  id: string;
  calendarid: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  sharedSecret: string;
  targetGroups: { targetGroupid: string }[];
}

export interface Property {
  id: string;
  calendarid: string;
  name: string;
  icon: string | null;
}

export interface Feature {
  id: string;
  calendarid: string;
  name: string;
}

export interface TargetGroup {
  id: string;
  calendarid: string;
  name: string;
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
}

export function formatAddress(loc: Pick<Location, "street" | "zip" | "city" | "country">): string {
  const parts: string[] = [];
  if (loc.street) parts.push(loc.street);
  const cityPart = [loc.zip, loc.city].filter(Boolean).join(" ");
  if (cityPart) parts.push(cityPart);
  if (loc.country) parts.push(loc.country);
  return parts.join(", ");
}

export function formatLocationLabel(loc: Location): string {
  const addr = formatAddress(loc);
  if (loc.name && addr) return `${loc.name} — ${addr}`;
  return loc.name ?? addr ?? "";
}

export interface EventTemplate {
  id: string;
  calendarId: string;
  name: string;
  timezone: string;
  timeBegin: string;
  timeEnd: string;
  locationId: string | null;
  location: Location | null;
  properties: { property: Property }[];
  features: { feature: Feature }[];
  targetGroups: { targetGroup: TargetGroup }[];
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
