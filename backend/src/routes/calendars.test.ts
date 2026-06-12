import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const supertest = require('supertest')
import type { INestApplication } from '@nestjs/common'
import { createTestApp, createTestUser, createTestClub, createTestCalendar, getAuthHeader } from '../test/helpers'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

let app: INestApplication

beforeAll(async () => {
  app = await createTestApp()
})

afterAll(async () => {
  await app.close()
})

describe('GET /api/clubs/:clubId/calendars', () => {
  it('returns 401 without auth', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const res = await supertest(app.getHttpServer()).get(`/api/clubs/${club.id}/calendars`)
    expect(res.status).toBe(401)
  })

  it('returns calendars for the club', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'Cal 1' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/clubs/${club.id}/calendars`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { id: number }[]
    expect(body.some((c) => c.id === cal.id)).toBe(true)
  })
})

describe('POST /api/clubs/:clubId/calendars', () => {
  it('creates a calendar', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const res = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Vereinskalender' })
    expect(res.status).toBe(201)
    const body = res.body as { name: string }
    expect(body.name).toBe('Vereinskalender')
  })
})

describe('GET /api/clubs/:clubId/calendars/:calendarId', () => {
  it('returns 403 for non-member', async () => {
    const owner = await createTestUser({ email: 'owner2@example.com' })
    const other = await createTestUser({ email: 'other2@example.com' })
    await createTestClub(other.id)
    const club = await createTestClub(owner.id)
    const cal = await createTestCalendar(club.id)
    const res = await supertest(app.getHttpServer())
      .get(`/api/clubs/${club.id}/calendars/${cal.id}`)
      .set('Authorization', await getAuthHeader(other.id))
    expect(res.status).toBe(403)
  })

  it('returns 403 when calendar belongs to a different club (IDOR)', async () => {
    const user = await createTestUser()
    const club1 = await createTestClub(user.id, { name: 'Club 1' })
    const club2 = await createTestClub(user.id, { name: 'Club 2' })
    const calOfClub2 = await createTestCalendar(club2.id)
    // Access calendar of club2 through club1's URL
    const res = await supertest(app.getHttpServer())
      .get(`/api/clubs/${club1.id}/calendars/${calOfClub2.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(403)
  })

  it('returns the calendar for a member', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'My Cal' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/clubs/${club.id}/calendars/${cal.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { id: number; name: string }
    expect(body.id).toBe(cal.id)
  })
})

describe('PATCH /api/clubs/:clubId/calendars/:calendarId', () => {
  it('updates the calendar name', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'Old Name' })
    const res = await supertest(app.getHttpServer())
      .patch(`/api/clubs/${club.id}/calendars/${cal.id}`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'New Name' })
    expect(res.status).toBe(200)
    const body = res.body as { name: string }
    expect(body.name).toBe('New Name')
  })
})

describe('DELETE /api/clubs/:clubId/calendars/:calendarId', () => {
  it('deletes the calendar', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id)
    const res = await supertest(app.getHttpServer())
      .delete(`/api/clubs/${club.id}/calendars/${cal.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/clubs/:clubId/calendars/:calendarId/archive', () => {
  it('sets archivedAt on the calendar', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'To Archive' })
    const res = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/archive`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { archivedAt: string }
    expect(body.archivedAt).toBeTruthy()
  })
})

describe('POST /api/clubs/:clubId/calendars/:calendarId/unarchive', () => {
  it('clears archivedAt on the calendar', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id)
    await prisma.calendar.update({ where: { id: cal.id }, data: { archivedAt: new Date() } })
    const res = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/unarchive`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { archivedAt: string | null }
    expect(body.archivedAt).toBeNull()
  })
})

describe('GET /api/clubs/:clubId/calendars — includeArchived', () => {
  it('excludes archived calendars by default', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const active = await createTestCalendar(club.id, { name: 'Active' })
    const archived = await createTestCalendar(club.id, { name: 'Archived' })
    await prisma.calendar.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })
    const res = await supertest(app.getHttpServer())
      .get(`/api/clubs/${club.id}/calendars`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const ids = (res.body as { id: number }[]).map((c) => c.id)
    expect(ids).toContain(active.id)
    expect(ids).not.toContain(archived.id)
  })

  it('includes archived calendars when includeArchived=true', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const archived = await createTestCalendar(club.id, { name: 'Archived2' })
    await prisma.calendar.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })
    const res = await supertest(app.getHttpServer())
      .get(`/api/clubs/${club.id}/calendars?includeArchived=true`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const ids = (res.body as { id: number }[]).map((c) => c.id)
    expect(ids).toContain(archived.id)
  })
})

describe('POST /api/clubs/:clubId/calendars/:calendarId/duplicate', () => {
  it('creates a new calendar named "Copy of <original>"', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'Original' })
    const res = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/duplicate`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(201)
    const body = res.body as { name: string; id: number }
    expect(body.name).toBe('Copy of Original')
    expect(body.id).not.toBe(cal.id)
  })

  it('copies properties, features, and target groups', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'With Data' })
    await prisma.property.create({ data: { calendarId: cal.id, name: 'Prop1', icon: '🎯' } })
    await prisma.feature.create({ data: { calendarId: cal.id, name: 'Feature1' } })
    await prisma.targetGroup.create({ data: { calendarId: cal.id, name: 'Group1' } })
    const dupRes = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/duplicate`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(dupRes.status).toBe(201)
    const newId = (dupRes.body as { id: number }).id
    const props = await prisma.property.findMany({ where: { calendarId: newId } })
    const features = await prisma.feature.findMany({ where: { calendarId: newId } })
    const tgs = await prisma.targetGroup.findMany({ where: { calendarId: newId } })
    expect(props.some((p) => p.name === 'Prop1')).toBe(true)
    expect(features.some((f) => f.name === 'Feature1')).toBe(true)
    expect(tgs.some((tg) => tg.name === 'Group1')).toBe(true)
  })

  it('does not copy events', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'Has Events' })
    await prisma.event.create({
      data: { calendarId: cal.id, name: 'Event1', date: new Date('2026-07-01'), timeBegin: '10:00', timeEnd: '11:00', timezone: 'Europe/Berlin' },
    })
    const dupRes = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/duplicate`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(dupRes.status).toBe(201)
    const newId = (dupRes.body as { id: number }).id
    const events = await prisma.event.findMany({ where: { calendarId: newId } })
    expect(events).toHaveLength(0)
  })

  it('creates new feed secrets on duplicate', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'Has Feed' })
    const originalFeed = await prisma.calendarFeed.create({
      data: { calendarId: cal.id, name: 'My Feed', visibility: 'PUBLIC', sharedSecret: 'original-secret-xyz' },
    })
    const dupRes = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/duplicate`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(dupRes.status).toBe(201)
    const newId = (dupRes.body as { id: number }).id
    const newFeeds = await prisma.calendarFeed.findMany({ where: { calendarId: newId } })
    expect(newFeeds).toHaveLength(1)
    expect(newFeeds[0].name).toBe('My Feed')
    expect(newFeeds[0].sharedSecret).not.toBe(originalFeed.sharedSecret)
  })
})
