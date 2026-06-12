import { describe, it, expect } from 'vitest'
import { createSeriesFromTemplate, listEvents } from './eventService.js'
import {
  createTestUser,
  createTestClub,
  createTestCalendar,
  createTestCalendarWithClub,
  createTestEvent,
  createTestTemplate,
} from '../test/helpers.js'

describe('createSeriesFromTemplate', () => {
  it('creates 3 events from 3 dates', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const template = await createTestTemplate(calendar.id)
    const dates = ['2026-07-01', '2026-07-08', '2026-07-15']
    const events = await createSeriesFromTemplate(calendar.id, template.id, dates)
    expect(events.length).toBe(3)
    expect(events.every((e) => e.name === template.name)).toBe(true)
    expect(events.every((e) => e.eventTemplateId === template.id)).toBe(true)
  })

  it('throws 404 when template belongs to another calendar', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const otherUser = await createTestUser({ email: 'other-svc@example.com' })
    const otherClub = await createTestClub(otherUser.id)
    const otherCalendar = await createTestCalendar(otherClub.id)
    const templateInOtherCalendar = await createTestTemplate(otherCalendar.id)
    await expect(
      createSeriesFromTemplate(calendar.id, templateInOtherCalendar.id, ['2026-07-01']),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('listEvents', () => {
  it('respects from/to date filter', async () => {
    const { calendar } = await createTestCalendarWithClub()
    await createTestEvent(calendar.id, { name: 'Before', date: '2026-05-01' })
    await createTestEvent(calendar.id, { name: 'In Range', date: '2026-06-15' })
    await createTestEvent(calendar.id, { name: 'After', date: '2026-08-01' })

    const results = await listEvents(calendar.id, '2026-06-01', '2026-06-30')
    expect(results.length).toBe(1)
    expect(results[0].name).toBe('In Range')
  })
})
