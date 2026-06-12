import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const supertest = require('supertest')
import type { INestApplication } from '@nestjs/common'
import { createTestApp, createTestCalendarWithClub, createTestEvent } from '../test/helpers'
import { prisma } from '../lib/prisma'
import { FeedVisibility } from '@prisma/client'
import { randomUUID } from 'crypto'

let app: INestApplication

beforeAll(async () => {
  app = await createTestApp()
})

afterAll(async () => {
  await app.close()
})

async function createFeed(calendarId: number, options: {
  visibility?: FeedVisibility
  isDraft?: boolean
  secret?: string
} = {}) {
  return prisma.calendarFeed.create({
    data: {
      calendarId,
      name: 'Test Feed',
      visibility: options.visibility ?? FeedVisibility.PUBLIC,
      sharedSecret: options.secret ?? randomUUID(),
      isDraft: options.isDraft ?? false,
    },
  })
}

describe('GET /api/feed/:feedId/ics', () => {
  it('returns 404 for non-existent feed', async () => {
    const res = await supertest(app.getHttpServer()).get('/api/feed/99999/ics')
    expect(res.status).toBe(404)
  })

  it('returns 404 for draft feed', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id, { isDraft: true })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/ics`)
    expect(res.status).toBe(404)
  })

  it('returns ICS for public feed', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id)
    await createTestEvent(calendar.id, { name: 'Public Event', isDraft: false })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/ics`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/calendar')
    expect(res.text).toContain('BEGIN:VCALENDAR')
    expect(res.text).toContain('Public Event')
  })

  it('returns 403 for private feed without secret', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id, { visibility: FeedVisibility.PRIVATE })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/ics`)
    expect(res.status).toBe(403)
  })

  it('returns 403 for private feed with wrong secret', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id, { visibility: FeedVisibility.PRIVATE })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/ics?secret=completely-wrong-secret`)
    expect(res.status).toBe(403)
  })

  it('returns ICS for private feed with correct secret', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const secret = randomUUID()
    const feed = await createFeed(calendar.id, { visibility: FeedVisibility.PRIVATE, secret })
    await createTestEvent(calendar.id, { isDraft: false })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/ics?secret=${secret}`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('BEGIN:VCALENDAR')
  })

  it('excludes draft events from ICS', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id)
    await createTestEvent(calendar.id, { name: 'Draft Event', isDraft: true })
    await createTestEvent(calendar.id, { name: 'Published Event', isDraft: false })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/ics`)
    expect(res.text).not.toContain('Draft Event')
    expect(res.text).toContain('Published Event')
  })
})

describe('GET /api/feed/:feedId/events', () => {
  it('returns 404 for non-existent feed', async () => {
    const res = await supertest(app.getHttpServer()).get('/api/feed/99999/events')
    expect(res.status).toBe(404)
  })

  it('returns JSON events for public feed', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id)
    await createTestEvent(calendar.id, { name: 'JSON Event', isDraft: false })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/events`)
    expect(res.status).toBe(200)
    const body = res.body as { feed: { name: string }; events: { name: string }[] }
    expect(body.feed.name).toBe('Test Feed')
    expect(body.events.some((e) => e.name === 'JSON Event')).toBe(true)
  })

  it('returns 403 for private feed without secret', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id, { visibility: FeedVisibility.PRIVATE })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/events`)
    expect(res.status).toBe(403)
  })

  it('returns events for private feed with correct secret', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const secret = randomUUID()
    const feed = await createFeed(calendar.id, { visibility: FeedVisibility.PRIVATE, secret })
    await createTestEvent(calendar.id, { isDraft: false })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/events?secret=${secret}`)
    expect(res.status).toBe(200)
    const body = res.body as { events: unknown[] }
    expect(Array.isArray(body.events)).toBe(true)
  })
})
