import ical from 'ical-generator'
import { DateTime } from 'luxon'
import type { Event, Location, Property, Feature, TargetGroup } from '@prisma/client'

type EventWithRelations = Event & {
  location: (Location & {
    name?: string | null
    street?: string | null
    zip?: string | null
    city?: string | null
    country?: string | null
    latitude?: number | null
    longitude?: number | null
  }) | null
  properties: { property: Property }[]
  features: { feature: Feature }[]
  targetGroups: { targetGroup: TargetGroup }[]
}

function buildDescription(ev: EventWithRelations): string {
  const parts: string[] = []
  if (ev.features.length > 0) {
    parts.push(`Features: ${ev.features.map((f) => f.feature.name).join(', ')}`)
  }
  if (ev.targetGroups.length > 0) {
    parts.push(`Zielgruppen: ${ev.targetGroups.map((t) => t.targetGroup.name).join(', ')}`)
  }
  return parts.join('\n')
}

function buildLocationStr(loc: EventWithRelations['location']): string | undefined {
  if (!loc) return undefined
  const parts: string[] = []
  if (loc.name) parts.push(loc.name)
  if (loc.street) parts.push(loc.street)
  const cityPart = [loc.zip, loc.city].filter(Boolean).join(' ')
  if (cityPart) parts.push(cityPart)
  if (loc.country) parts.push(loc.country)
  return parts.length > 0 ? parts.join(', ') : undefined
}

function buildXAppleLine(ev: EventWithRelations): string | null {
  const loc = ev.location
  if (!loc || loc.latitude == null || loc.longitude == null) return null

  const addrParts: string[] = []
  if (loc.street) addrParts.push(loc.street)
  const cityLine = [loc.zip, loc.city].filter(Boolean).join(' ')
  if (cityLine) addrParts.push(cityLine)
  if (loc.country) addrParts.push(loc.country)

  const xAddress = addrParts.join('\\n')
  const xTitle = loc.name ?? addrParts[0] ?? ''

  const params: string[] = ['VALUE=URI']
  if (xTitle) params.push(`X-TITLE="${xTitle}"`)
  if (xAddress) params.push(`X-ADDRESS="${xAddress}"`)
  params.push('X-APPLE-RADIUS=100')

  return `X-APPLE-STRUCTURED-LOCATION;${params.join(';')}:geo:${loc.latitude},${loc.longitude}`
}

export function buildIcs(feedName: string, clubTimezone: string, events: EventWithRelations[]): string {
  const cal = ical({ name: feedName })

  for (const ev of events) {
    const tz = ev.timezone ?? clubTimezone
    const startDateStr = ev.date.toISOString().slice(0, 10)

    const iconPrefix = ev.properties
      .map((ep) => ep.property.icon)
      .filter(Boolean)
      .join(' ')
    const summary = iconPrefix ? `${iconPrefix} ${ev.name}` : ev.name
    const locationStr = buildLocationStr(ev.location)

    if (ev.isAllDay) {
      const endDateStr = ev.dateEnd
        ? ev.dateEnd.toISOString().slice(0, 10)
        : startDateStr
      const endDate = new Date(endDateStr)
      endDate.setDate(endDate.getDate() + 1)

      cal.createEvent({
        id: `event-${ev.id}@club-calendar`,
        summary,
        start: new Date(startDateStr + 'T00:00:00'),
        end: endDate,
        allDay: true,
        location: locationStr,
        ...(ev.location?.latitude != null && ev.location?.longitude != null
          ? { geo: { lat: ev.location.latitude, lon: ev.location.longitude } }
          : {}),
        description: buildDescription(ev) || undefined,
      })
    } else {
      const start = DateTime.fromFormat(`${startDateStr} ${ev.timeBegin}`, 'yyyy-MM-dd HH:mm', { zone: tz }).toJSDate()
      const endDateStr = ev.dateEnd
        ? ev.dateEnd.toISOString().slice(0, 10)
        : startDateStr
      const end = DateTime.fromFormat(`${endDateStr} ${ev.timeEnd}`, 'yyyy-MM-dd HH:mm', { zone: tz }).toJSDate()

      cal.createEvent({
        id: `event-${ev.id}@club-calendar`,
        summary,
        start,
        end,
        location: locationStr,
        ...(ev.location?.latitude != null && ev.location?.longitude != null
          ? { geo: { lat: ev.location.latitude, lon: ev.location.longitude } }
          : {}),
        description: buildDescription(ev) || undefined,
      })
    }
  }

  // Inject X-APPLE-STRUCTURED-LOCATION after the GEO line per event (ical-generator
  // can't emit this property with the correct casing/URI formatting via its x-API)
  let icsStr = cal.toString()
  for (const ev of events) {
    const xAppleLine = buildXAppleLine(ev)
    if (!xAppleLine) continue
    const uid = `event-${ev.id}@club-calendar`
    icsStr = icsStr.replace(
      new RegExp(`(UID:${uid}[\\s\\S]*?)(\\r?\\nEND:VEVENT)`),
      `$1\r\n${xAppleLine}$2`,
    )
  }

  return icsStr
}
