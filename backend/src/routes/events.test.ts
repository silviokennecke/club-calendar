import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const supertest = require('supertest')
import type { INestApplication } from '@nestjs/common'
import {
  createTestApp,
  createTestUser,
  createTestClub,
  createTestCalendar,
  createTestCalendarWithClub,
  createTestEvent,
  createTestTemplate,
  getAuthHeader,
} from '../test/helpers'

let app: INestApplication

beforeAll(async () => {
  app = await createTestApp()
})

afterAll(async () => {
  await app.close()
})

describe('Events /api/calendars/:calendarId/events', () => {
  it('returns empty array initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/events`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('creates a single event', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/events`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({
        name: 'Club Night',
        date: '2026-07-01',
        timeBegin: '20:00',
        timeEnd: '23:00',
        isDraft: false,
        timezone: 'Europe/Berlin',
      })
    expect(res.status).toBe(201)
    const body = res.body as { name: string; isDraft: boolean; date: string }
    expect(body.name).toBe('Club Night')
    expect(body.isDraft).toBe(false)
  })

  it('filters events by date range', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    await createTestEvent(calendar.id, { name: 'Before Range', date: '2026-05-01' })
    await createTestEvent(calendar.id, { name: 'In Range', date: '2026-06-15' })
    await createTestEvent(calendar.id, { name: 'After Range', date: '2026-08-01' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/events?from=2026-06-01&to=2026-06-30`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { name: string }[]
    expect(body.length).toBe(1)
    expect(body[0].name).toBe('In Range')
  })

  it('creates events from template (series)', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const template = await createTestTemplate(calendar.id)
    const res = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/events/from-template`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({
        templateId: template.id,
        dates: ['2026-07-01', '2026-07-08', '2026-07-15'],
      })
    expect(res.status).toBe(201)
    const body = res.body as { name: string }[]
    expect(body.length).toBe(3)
    expect(body[0].name).toBe(template.name)
  })

  it('gets a single event by id', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const event = await createTestEvent(calendar.id)
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/events/${event.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { id: number; name: string }
    expect(body.id).toBe(event.id)
    expect(body.name).toBe(event.name)
  })

  it('updates event name and isDraft', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const event = await createTestEvent(calendar.id)
    const res = await supertest(app.getHttpServer())
      .patch(`/api/calendars/${calendar.id}/events/${event.id}`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Updated Event', isDraft: true })
    expect(res.status).toBe(200)
    const body = res.body as { name: string; isDraft: boolean }
    expect(body.name).toBe('Updated Event')
    expect(body.isDraft).toBe(true)
  })

  it('deletes an event', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const event = await createTestEvent(calendar.id)
    const deleteRes = await supertest(app.getHttpServer())
      .delete(`/api/calendars/${calendar.id}/events/${event.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(deleteRes.status).toBe(200)
    // confirm it's gone
    const getRes = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/events/${event.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(getRes.status).toBe(404)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-events@example.com' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/events`)
      .set('Authorization', await getAuthHeader(other.id))
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown event id', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/events/999999`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(404)
  })

  it('returns 404 when creating series from template of another calendar', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const otherUser = await createTestUser({ email: 'other-calendar-owner@example.com' })
    const otherClub = await createTestClub(otherUser.id)
    const otherCalendar = await createTestCalendar(otherClub.id)
    const templateInOtherCalendar = await createTestTemplate(otherCalendar.id, { name: 'Other Template' })
    const res = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/events/from-template`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({
        templateId: templateInOtherCalendar.id,
        dates: ['2026-07-01'],
      })
    expect(res.status).toBe(404)
  })

  it('returns 404 when accessing event from another calendar (IDOR)', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const otherUser = await createTestUser({ email: 'other-idor@example.com' })
    const otherClub = await createTestClub(otherUser.id)
    const otherCalendar = await createTestCalendar(otherClub.id)
    await createTestClub(user.id) // make user member of a second club to trigger club membership check
    const eventInOtherCalendar = await createTestEvent(otherCalendar.id, { name: 'Inaccessible' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/events/${eventInOtherCalendar.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid from date query param', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/events?from=notadate`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(400)
  })
})
