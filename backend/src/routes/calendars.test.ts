import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const supertest = require('supertest')
import type { INestApplication } from '@nestjs/common'
import { createTestApp, createTestUser, createTestClub, createTestCalendar, getAuthHeader } from '../test/helpers'

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
