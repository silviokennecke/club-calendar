import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const supertest = require('supertest')
import type { INestApplication } from '@nestjs/common'
import { createTestApp, createTestUser, createTestCalendarWithClub, getAuthHeader } from '../test/helpers'

let app: INestApplication

beforeAll(async () => {
  app = await createTestApp()
})

afterAll(async () => {
  await app.close()
})

// ─── Properties ──────────────────────────────────────────────────────────────

describe('Properties /api/calendars/:calendarId/properties', () => {
  it('returns empty list initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/properties`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('creates a property', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/properties`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Indoor', icon: '🏠' })
    expect(res.status).toBe(201)
    const body = res.body as { name: string; icon: string }
    expect(body.name).toBe('Indoor')
    expect(body.icon).toBe('🏠')
  })

  it('updates a property', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/properties`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Outdoor' })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .patch(`/api/calendars/${calendar.id}/properties/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Indoor' })
    expect(res.status).toBe(200)
    const body = res.body as { name: string }
    expect(body.name).toBe('Indoor')
  })

  it('deletes a property', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/properties`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'ToDelete' })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .delete(`/api/calendars/${calendar.id}/properties/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-prop@example.com' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/properties`)
      .set('Authorization', await getAuthHeader(other.id))
    expect(res.status).toBe(403)
  })
})

// ─── Features ────────────────────────────────────────────────────────────────

describe('Features /api/calendars/:calendarId/features', () => {
  it('returns empty list initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/features`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('creates a feature', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/features`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Live Music' })
    expect(res.status).toBe(201)
    const body = res.body as { name: string }
    expect(body.name).toBe('Live Music')
  })

  it('updates a feature', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/features`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Old Feature' })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .patch(`/api/calendars/${calendar.id}/features/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'New Feature' })
    expect(res.status).toBe(200)
    const body = res.body as { name: string }
    expect(body.name).toBe('New Feature')
  })

  it('deletes a feature', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/features`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'ToDelete' })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .delete(`/api/calendars/${calendar.id}/features/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-feat@example.com' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/features`)
      .set('Authorization', await getAuthHeader(other.id))
    expect(res.status).toBe(403)
  })
})

// ─── Target Groups ────────────────────────────────────────────────────────────

describe('Target Groups /api/calendars/:calendarId/target-groups', () => {
  it('returns empty list initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/target-groups`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('creates a target group', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/target-groups`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Seniors' })
    expect(res.status).toBe(201)
    const body = res.body as { name: string }
    expect(body.name).toBe('Seniors')
  })

  it('updates a target group', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/target-groups`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Old Group' })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .patch(`/api/calendars/${calendar.id}/target-groups/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Juniors' })
    expect(res.status).toBe(200)
    const body = res.body as { name: string }
    expect(body.name).toBe('Juniors')
  })

  it('deletes a target group', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/target-groups`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'ToDelete' })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .delete(`/api/calendars/${calendar.id}/target-groups/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-tg@example.com' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/target-groups`)
      .set('Authorization', await getAuthHeader(other.id))
    expect(res.status).toBe(403)
  })
})

// ─── Locations ────────────────────────────────────────────────────────────────

describe('Locations /api/calendars/:calendarId/locations', () => {
  it('returns empty list initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/locations`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('creates a location', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/locations`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ address: 'Hauptstraße 1, 10115 Berlin' })
    expect(res.status).toBe(201)
    const body = res.body as { address: string }
    expect(body.address).toBe('Hauptstraße 1, 10115 Berlin')
  })

  it('updates a location', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/locations`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ address: 'Old Street 1' })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .patch(`/api/calendars/${calendar.id}/locations/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ address: 'New Street 2' })
    expect(res.status).toBe(200)
    const body = res.body as { address: string }
    expect(body.address).toBe('New Street 2')
  })

  it('deletes a location', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/locations`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ address: 'ToDelete Street' })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .delete(`/api/calendars/${calendar.id}/locations/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-loc@example.com' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/locations`)
      .set('Authorization', await getAuthHeader(other.id))
    expect(res.status).toBe(403)
  })
})

// ─── Event Templates ──────────────────────────────────────────────────────────

describe('Event Templates /api/calendars/:calendarId/templates', () => {
  it('returns empty list initially', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/templates`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('creates a template', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const res = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/templates`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({
        name: 'Weekly Training',
        timezone: 'Europe/Berlin',
        timeBegin: '18:00',
        timeEnd: '20:00',
      })
    expect(res.status).toBe(201)
    const body = res.body as { name: string; timeBegin: string; timeEnd: string }
    expect(body.name).toBe('Weekly Training')
    expect(body.timeBegin).toBe('18:00')
    expect(body.timeEnd).toBe('20:00')
  })

  it('gets a single template', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/templates`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({
        name: 'Single Template',
        timezone: 'Europe/Berlin',
        timeBegin: '10:00',
        timeEnd: '12:00',
      })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/templates/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { id: number; name: string }
    expect(body.id).toBe(created.id)
    expect(body.name).toBe('Single Template')
  })

  it('updates a template', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/templates`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({
        name: 'Old Template',
        timezone: 'Europe/Berlin',
        timeBegin: '08:00',
        timeEnd: '09:00',
      })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .patch(`/api/calendars/${calendar.id}/templates/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'New Template Name' })
    expect(res.status).toBe(200)
    const body = res.body as { name: string }
    expect(body.name).toBe('New Template Name')
  })

  it('creates a template with related ids and includes them in response', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    // Create a property first
    const propRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/properties`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Indoor' })
    const prop = propRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/templates`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({
        name: 'Template With Props',
        timezone: 'Europe/Berlin',
        timeBegin: '14:00',
        timeEnd: '16:00',
        propertyIds: [prop.id],
      })
    expect(res.status).toBe(201)
    const body = res.body as { properties: { propertyId: number }[] }
    expect(body.properties.some((p) => p.propertyId === prop.id)).toBe(true)
  })

  it('deletes a template', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    const createRes = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/templates`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({
        name: 'ToDelete',
        timezone: 'Europe/Berlin',
        timeBegin: '07:00',
        timeEnd: '08:00',
      })
    const created = createRes.body as { id: number }
    const res = await supertest(app.getHttpServer())
      .delete(`/api/calendars/${calendar.id}/templates/${created.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
  })

  it('returns 403 for non-member', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const other = await createTestUser({ email: 'other-tmpl@example.com' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/templates`)
      .set('Authorization', await getAuthHeader(other.id))
    expect(res.status).toBe(403)
  })
})
