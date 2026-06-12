export interface User {
  id: number
  name: string
  email: string
  dateFormat: string
  firstDayOfWeek: number
  lastClubId?: number | null
  lastCalendarId?: number | null
}

export interface Club {
  id: number
  name: string
  timezone: string
}

export interface Calendar {
  id: number
  clubId: number
  name: string
  timezone?: string | null
}

export interface CalendarFeed {
  id: number
  calendarId: number
  name: string
  visibility: 'PUBLIC' | 'PRIVATE'
  sharedSecret: string
  targetGroups: { targetGroupId: number }[]
}

export interface Property {
  id: number
  calendarId: number
  name: string
  icon: string | null
}

export interface Feature {
  id: number
  calendarId: number
  name: string
}

export interface TargetGroup {
  id: number
  calendarId: number
  name: string
}

export interface Location {
  id: number
  calendarId: number
  name?: string | null
  street?: string | null
  zip?: string | null
  city?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
}

export function formatAddress(loc: Pick<Location, 'street' | 'zip' | 'city' | 'country'>): string {
  const parts: string[] = []
  if (loc.street) parts.push(loc.street)
  const cityPart = [loc.zip, loc.city].filter(Boolean).join(' ')
  if (cityPart) parts.push(cityPart)
  if (loc.country) parts.push(loc.country)
  return parts.join(', ')
}

export function formatLocationLabel(loc: Location): string {
  const addr = formatAddress(loc)
  if (loc.name && addr) return `${loc.name} — ${addr}`
  return loc.name ?? addr ?? ''
}

export interface EventTemplate {
  id: number
  calendarId: number
  name: string
  timezone: string
  timeBegin: string
  timeEnd: string
  locationId: number | null
  location: Location | null
  properties: { property: Property }[]
  features: { feature: Feature }[]
  targetGroups: { targetGroup: TargetGroup }[]
}

export interface CalendarEvent {
  id: number
  calendarId: number
  name: string
  date: string
  dateEnd?: string | null    // YYYY-MM-DD, null/undefined = same day as date
  timeBegin: string
  timeEnd: string
  isAllDay?: boolean         // default false
  timezone: string | null
  isDraft: boolean
  locationId: number | null
  location: Location | null
  properties: { property: Property }[]
  features: { feature: Feature }[]
  targetGroups: { targetGroup: TargetGroup }[]
}
