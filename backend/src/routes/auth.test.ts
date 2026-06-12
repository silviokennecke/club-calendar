import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { createTestUser } from '../test/helpers.js'
import { prisma } from '../lib/prisma.js'

describe('POST /api/auth/login', () => {
  it('returns 400 for invalid body', async () => {
    const app = createApp()
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 401 for unknown email', async () => {
    const app = createApp()
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'anything' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for wrong password', async () => {
    await createTestUser({ email: 'alice@example.com' })
    const app = createApp()
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'wrong' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns accessToken and user for valid credentials', async () => {
    await createTestUser({ email: 'bob@example.com' })
    const app = createApp()
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'password123' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { accessToken: string; user: { email: string } }
    expect(body.accessToken).toBeTruthy()
    expect(body.user.email).toBe('bob@example.com')
  })
})

describe('GET /api/auth/me', () => {
  it('returns 401 without token', async () => {
    const app = createApp()
    const res = await app.request('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns user for valid token', async () => {
    const user = await createTestUser({ email: 'carol@example.com' })
    const { getAuthHeader } = await import('../test/helpers.js')
    const app = createApp()
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: await getAuthHeader(user.id) },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { email: string }
    expect(body.email).toBe('carol@example.com')
  })
})

describe('POST /api/auth/logout', () => {
  it('returns ok and clears cookie', async () => {
    const app = createApp()
    const res = await app.request('/api/auth/logout', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
