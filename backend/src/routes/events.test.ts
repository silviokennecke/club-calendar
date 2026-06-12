import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import {
  createTestUser,
  createTestClub,
  createTestCalendar,
  createTestCalendarWithClub,
  createTestEvent,
  createTestTemplate,
  getAuthHeader,
} from '../test/helpers.js'

describe('Events /api/calendars/:calendarId/events', () => {
  it('returns empty array initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/events`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('creates a single event', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/events`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Club Night',
        date: '2026-07-01',
        timeBegin: '20:00',
        timeEnd: '23:00',
        isDraft: false,
        timezone: 'Europe/Berlin',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { name: string; isDraft: boolean; date: string }
    expect(body.name).toBe('Club Night')
    expect(body.isDraft).toBe(false)
  })

  it('filters events by date range', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    await createTestEvent(calendar.id, { name: 'Before Range', date: '2026-05-01' })
    await createTestEvent(calendar.id, { name: 'In Range', date: '2026-06-15' })
    await createTestEvent(calendar.id, { name: 'After Range', date: '2026-08-01' })
    const app = createApp()
    const res = await app.request(
      `/api/calendars/${calendar.id}/events?from=2026-06-01&to=2026-06-30`,
      { headers: { Authorization: await getAuthHeader(user.id) } },
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string }[]
    expect(body.length).toBe(1)
    expect(body[0].name).toBe('In Range')
  })

  it('creates events from template (series)', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const template = await createTestTemplate(calendar.id)
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/events/from-template`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: template.id,
        dates: ['2026-07-01', '2026-07-08', '2026-07-15'],
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { name: string }[]
    expect(body.length).toBe(3)
    expect(body[0].name).toBe(template.name)
  })

  it('gets a single event by id', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const event = await createTestEvent(calendar.id)
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/events/${event.id}`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { id: number; name: string }
    expect(body.id).toBe(event.id)
    expect(body.name).toBe(event.name)
  })

  it('updates event name and isDraft', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const event = await createTestEvent(calendar.id)
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/events/${event.id}`, {
      method: 'PATCH',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Event', isDraft: true }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string; isDraft: boolean }
    expect(body.name).toBe('Updated Event')
    expect(body.isDraft).toBe(true)
  })

  it('deletes an event', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const event = await createTestEvent(calendar.id)
    const app = createApp()
    const deleteRes = await app.request(`/api/calendars/${calendar.id}/events/${event.id}`, {
      method: 'DELETE',
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(deleteRes.status).toBe(200)
    // confirm it's gone
    const getRes = await app.request(`/api/calendars/${calendar.id}/events/${event.id}`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(getRes.status).toBe(404)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-events@example.com' })
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/events`, {
      headers: { Authorization: await getAuthHeader(other.id) },
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown event id', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/events/999999`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 when creating series from template of another calendar', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const otherUser = await createTestUser({ email: 'other-calendar-owner@example.com' })
    const otherClub = await createTestClub(otherUser.id)
    const otherCalendar = await createTestCalendar(otherClub.id)
    const templateInOtherCalendar = await createTestTemplate(otherCalendar.id, { name: 'Other Template' })
    const app = createApp()
    const res = await app.request(`/api/calendars/${calendar.id}/events/from-template`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: templateInOtherCalendar.id,
        dates: ['2026-07-01'],
      }),
    })
    expect(res.status).toBe(404)
  })
})
