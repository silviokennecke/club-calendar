import ical from 'ical-generator'
import { DateTime } from 'luxon'
import type { Event, Location, Property, Feature, TargetGroup } from '@prisma/client'

type EventWithRelations = Event & {
  location: Location | null
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
    const dateStr = ev.date.toISOString().slice(0, 10) // YYYY-MM-DD

    const start = DateTime.fromFormat(`${dateStr} ${ev.timeBegin}`, 'yyyy-MM-dd HH:mm', {
      zone: tz,
    }).toJSDate()

    const end = DateTime.fromFormat(`${dateStr} ${ev.timeEnd}`, 'yyyy-MM-dd HH:mm', {
      zone: tz,
    }).toJSDate()

    const iconPrefix = ev.properties
      .map((ep) => ep.property.icon)
      .filter(Boolean)
      .join(' ')
    const summary = iconPrefix ? `${iconPrefix} ${ev.name}` : ev.name

    cal.createEvent({
      id: `event-${ev.id}@club-calendar`,
      summary,
      start,
      end,
      location: ev.location?.address,
      description: buildDescription(ev) || undefined,
    })
  }

  return cal.toString()
}
