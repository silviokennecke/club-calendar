import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const supertest = require('supertest')
import type { INestApplication } from '@nestjs/common'
import { createTestApp, createTestUser, getAuthHeader } from '../test/helpers'

let app: INestApplication

beforeAll(async () => {
  app = await createTestApp()
})

afterAll(async () => {
  await app.close()
})

describe('POST /api/auth/login', () => {
  it('returns 400 for invalid body', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' })
    expect(res.status).toBe(400)
  })

  it('returns 401 for unknown email', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'anything' })
    expect(res.status).toBe(401)
  })

  it('returns 401 for wrong password', async () => {
    await createTestUser({ email: 'alice@example.com' })
    const res = await supertest(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('returns accessToken, user, and sets httpOnly cookie for valid credentials', async () => {
    await createTestUser({ email: 'bob@example.com' })
    const res = await supertest(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'bob@example.com', password: 'password123' })
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
    expect(res.body.user.email).toBe('bob@example.com')
    const cookie = res.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toContain('refreshToken=')
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie.toLowerCase()).toContain('samesite=strict')
    expect(cookie).toContain('Path=/api/auth/refresh')
  })
})

describe('GET /api/auth/me', () => {
  it('returns 401 without token', async () => {
    const res = await supertest(app.getHttpServer()).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns user for valid token', async () => {
    const user = await createTestUser({ email: 'carol@example.com' })
    const res = await supertest(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('carol@example.com')
  })
})

describe('POST /api/auth/refresh', () => {
  it('returns 401 with no cookie', async () => {
    const res = await supertest(app.getHttpServer()).post('/api/auth/refresh')
    expect(res.status).toBe(401)
  })

  it('returns 401 with invalid token', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', 'refreshToken=invalid.token.here')
    expect(res.status).toBe(401)
  })

  it('returns new accessToken for valid refresh cookie', async () => {
    await createTestUser({ email: 'dave@example.com' })
    const loginRes = await supertest(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'dave@example.com', password: 'password123' })
    const cookie = loginRes.headers['set-cookie']?.[0] ?? ''
    const tokenMatch = cookie.match(/refreshToken=([^;]+)/)
    expect(tokenMatch).toBeTruthy()
    const refreshToken = tokenMatch![1]

    const refreshRes = await supertest(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `refreshToken=${refreshToken}`)
    expect(refreshRes.status).toBe(200)
    expect(refreshRes.body.accessToken).toBeTruthy()
  })
})

describe('POST /api/auth/logout', () => {
  it('returns ok and clears cookie', async () => {
    const res = await supertest(app.getHttpServer()).post('/api/auth/logout')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})
