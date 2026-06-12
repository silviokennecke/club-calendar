import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { createTestUser, createTestClub, getAuthHeader } from '../test/helpers.js'

describe('GET /api/clubs', () => {
  it('returns 401 without auth', async () => {
    const app = createApp()
    const res = await app.request('/api/clubs')
    expect(res.status).toBe(401)
  })

  it('returns clubs the user belongs to', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id, { name: 'My Club' })
    const app = createApp()
    const res = await app.request('/api/clubs', {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { id: number; name: string }[]
    expect(body.some((c) => c.id === club.id)).toBe(true)
  })
})

describe('POST /api/clubs', () => {
  it('creates a club and returns 201', async () => {
    const user = await createTestUser()
    const app = createApp()
    const res = await app.request('/api/clubs', {
      method: 'POST',
      headers: { Authorization: await getAuthHeader(user.id), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Club', timezone: 'Europe/London' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { name: string }
    expect(body.name).toBe('New Club')
  })
})

describe('GET /api/clubs/:clubId', () => {
  it('returns 403 for non-member', async () => {
    const owner = await createTestUser({ email: 'owner@example.com' })
    const other = await createTestUser({ email: 'other@example.com' })
    const club = await createTestClub(owner.id)
    const app = createApp()
    const res = await app.request(`/api/clubs/${club.id}`, {
      headers: { Authorization: await getAuthHeader(other.id) },
    })
    expect(res.status).toBe(403)
  })

  it('returns club for member', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id, { name: 'My Club' })
    const app = createApp()
    const res = await app.request(`/api/clubs/${club.id}`, {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { id: number; name: string }
    expect(body.id).toBe(club.id)
  })
})

describe('DELETE /api/clubs/:clubId', () => {
  it('deletes the club', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const app = createApp()
    const res = await app.request(`/api/clubs/${club.id}`, {
      method: 'DELETE',
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
  })
})
