import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const supertest = require('supertest')
import type { INestApplication } from '@nestjs/common'
import { createTestApp, createTestUser, createTestClub, getAuthHeader } from '../test/helpers'

let app: INestApplication

beforeAll(async () => {
  app = await createTestApp()
})

afterAll(async () => {
  await app.close()
})

describe('GET /api/clubs', () => {
  it('returns 401 without auth', async () => {
    const res = await supertest(app.getHttpServer()).get('/api/clubs')
    expect(res.status).toBe(401)
  })

  it('returns clubs the user belongs to', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id, { name: 'My Club' })
    const res = await supertest(app.getHttpServer())
      .get('/api/clubs')
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { id: number; name: string }[]
    expect(body.some((c) => c.id === club.id)).toBe(true)
  })
})

describe('POST /api/clubs', () => {
  it('creates a club and returns 201', async () => {
    const user = await createTestUser()
    const res = await supertest(app.getHttpServer())
      .post('/api/clubs')
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'New Club', timezone: 'Europe/London' })
    expect(res.status).toBe(201)
    const body = res.body as { name: string }
    expect(body.name).toBe('New Club')
  })
})

describe('GET /api/clubs/:clubId', () => {
  it('returns 403 for non-member', async () => {
    const owner = await createTestUser({ email: 'owner@example.com' })
    const other = await createTestUser({ email: 'other@example.com' })
    const club = await createTestClub(owner.id)
    const res = await supertest(app.getHttpServer())
      .get(`/api/clubs/${club.id}`)
      .set('Authorization', await getAuthHeader(other.id))
    expect(res.status).toBe(403)
  })

  it('returns club for member', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id, { name: 'My Club' })
    const res = await supertest(app.getHttpServer())
      .get(`/api/clubs/${club.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { id: number; name: string }
    expect(body.id).toBe(club.id)
  })
})

describe('DELETE /api/clubs/:clubId', () => {
  it('deletes the club', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const res = await supertest(app.getHttpServer())
      .delete(`/api/clubs/${club.id}`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
  })
})
