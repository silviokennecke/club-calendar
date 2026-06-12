import ical from 'ical-generator'
import { DateTime } from 'luxon'
import type { Event, Location, Property, Feature, TargetGroup } from '@prisma/client'

type EventWithRelations = Event & {
  location: (Location & { name?: string | null; latitude?: number | null; longitude?: number | null }) | null
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

export function buildIcs(feedName: string, clubTimezone: string, events: EventWithRelations[]): string {
  const cal = ical({ name: feedName })

  for (const ev of events) {
    const tz = ev.timezone ?? clubTimezone
    const startDateStr = ev.date.toISOString().slice(0, 10) // YYYY-MM-DD

    const iconPrefix = ev.properties
      .map((ep) => ep.property.icon)
      .filter(Boolean)
      .join(' ')
    const summary = iconPrefix ? `${iconPrefix} ${ev.name}` : ev.name

    const locationStr = ev.location
      ? (ev.location.name ? `${ev.location.name} (${ev.location.address})` : ev.location.address)
      : undefined

    if (ev.isAllDay) {
      // All-day event: use date-only values
      const endDateStr = ev.dateEnd
        ? ev.dateEnd.toISOString().slice(0, 10)
        : startDateStr

      // For ICS all-day: end date is exclusive (add 1 day)
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
      // Timed event (single or multi-day)
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

  return cal.toString()
}
