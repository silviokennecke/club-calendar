import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../lib/prisma.js'
import { FeedVisibility } from '@prisma/client'
import { randomUUID } from 'crypto'
import { createTestCalendarWithClub, createTestEvent } from '../test/helpers.js'

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
    const app = createApp()
    const res = await app.request('/api/feed/99999/ics')
    expect(res.status).toBe(404)
  })

  it('returns 404 for draft feed', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id, { isDraft: true })
    const app = createApp()
    const res = await app.request(`/api/feed/${feed.id}/ics`)
    expect(res.status).toBe(404)
  })

  it('returns ICS for public feed', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id)
    await createTestEvent(calendar.id, { name: 'Public Event', isDraft: false })
    const app = createApp()
    const res = await app.request(`/api/feed/${feed.id}/ics`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/calendar')
    const body = await res.text()
    expect(body).toContain('BEGIN:VCALENDAR')
    expect(body).toContain('Public Event')
  })

  it('returns 403 for private feed without secret', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id, { visibility: FeedVisibility.PRIVATE })
    const app = createApp()
    const res = await app.request(`/api/feed/${feed.id}/ics`)
    expect(res.status).toBe(403)
  })

  it('returns ICS for private feed with correct secret', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const secret = randomUUID()
    const feed = await createFeed(calendar.id, {
      visibility: FeedVisibility.PRIVATE,
      secret,
    })
    await createTestEvent(calendar.id, { isDraft: false })
    const app = createApp()
    const res = await app.request(`/api/feed/${feed.id}/ics?secret=${secret}`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('BEGIN:VCALENDAR')
  })

  it('excludes draft events from ICS', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await createFeed(calendar.id)
    await createTestEvent(calendar.id, { name: 'Draft Event', isDraft: true })
    await createTestEvent(calendar.id, { name: 'Published Event', isDraft: false })
    const app = createApp()
    const res = await app.request(`/api/feed/${feed.id}/ics`)
    const body = await res.text()
    expect(body).not.toContain('Draft Event')
    expect(body).toContain('Published Event')
  })
})
