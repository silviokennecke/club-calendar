import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { createTestUser, createTestClub, createTestCalendar, getAuthHeader } from '../test/helpers.js'

describe('GET /api/clubs/:clubId/calendars', () => {
  it('returns 401 without auth', async () => {
    const app = createApp()
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const res = await app.request(`/api/clubs/${club.id}/calendars`)
    expect(res.status).toBe(401)
  })

  it('returns calendars for the club', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'Cal 1' })
    const app = createApp()
    const res = await app.request(`/api/clubs/${club.id}/calendars`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { id: number }[]
    expect(body.some((c) => c.id === cal.id)).toBe(true)
  })
})

describe('POST /api/clubs/:clubId/calendars', () => {
  it('creates a calendar', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const app = createApp()
    const res = await app.request(`/api/clubs/${club.id}/calendars`, {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Vereinskalender' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { name: string }
    expect(body.name).toBe('Vereinskalender')
  })
})

describe('DELETE /api/clubs/:clubId/calendars/:calendarId', () => {
  it('deletes the calendar', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id)
    const app = createApp()
    const res = await app.request(`/api/clubs/${club.id}/calendars/${cal.id}`, {
      method: 'DELETE',
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
  })
})
