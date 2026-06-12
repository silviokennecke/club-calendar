import { describe, it, expect } from 'vitest'
import { buildIcs } from './ics.js'

describe('buildIcs', () => {
  it('generates valid ICS with correct SUMMARY', () => {
    const events = [
      {
        id: 1,
        calendarId: 1,
        eventTemplateId: null,
        locationId: null,
        name: 'Vereinsabend',
        timezone: 'Europe/Berlin',
        date: new Date('2026-06-15'),
        timeBegin: '19:00',
        timeEnd: '22:00',
        isDraft: false,
        location: null,
        properties: [{ property: { id: 1, calendarId: 1, name: 'Schützentracht', icon: '🎯' } }],
        features: [{ feature: { id: 1, calendarId: 1, name: 'Bonusschießen' } }],
        targetGroups: [{ targetGroup: { id: 1, calendarId: 1, name: 'Erwachsene' } }],
      },
    ] as any

    const ics = buildIcs('Test Feed', 'Europe/Berlin', events)

    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('🎯 Vereinsabend')
    expect(ics).toContain('END:VEVENT')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('event-1@club-calendar')
  })

  it('generates ICS without icon prefix when no properties', () => {
    const events = [
      {
        id: 2,
        calendarId: 1,
        eventTemplateId: null,
        locationId: null,
        name: 'Simple Event',
        timezone: null,
        date: new Date('2026-06-20'),
        timeBegin: '10:00',
        timeEnd: '12:00',
        isDraft: false,
        location: { id: 1, calendarId: 1, street: 'Musterstraße 1', city: 'Berlin' },
        properties: [],
        features: [],
        targetGroups: [],
      },
    ] as any

    const ics = buildIcs('Test Feed', 'Europe/Berlin', events)
    expect(ics).toContain('SUMMARY:Simple Event')
    expect(ics).toContain('LOCATION:Musterstraße 1')
  })
})
