import { describe, it, expect } from 'vitest'
import { login, refresh, getMe } from './authService.js'
import { createTestUser } from '../test/helpers.js'

describe('login', () => {
  it('throws 401 for wrong password', async () => {
    await createTestUser({ email: 'dave@example.com' })
    await expect(login('dave@example.com', 'wrong')).rejects.toMatchObject({ status: 401 })
  })

  it('returns tokens for correct credentials', async () => {
    await createTestUser({ email: 'eve@example.com' })
    const result = await login('eve@example.com', 'password123')
    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()
  })
})

describe('refresh', () => {
  it('throws 401 for invalid refresh token', async () => {
    await expect(refresh('not.a.valid.token')).rejects.toMatchObject({ status: 401 })
  })

  it('returns new accessToken for valid refresh token', async () => {
    await createTestUser({ email: 'grace@example.com' })
    const { refreshToken } = await login('grace@example.com', 'password123')
    const result = await refresh(refreshToken)
    expect(result.accessToken).toBeTruthy()
  })
})

describe('getMe', () => {
  it('throws 401 for non-existent user', async () => {
    await expect(getMe(99999)).rejects.toMatchObject({ status: 401 })
  })

  it('returns user data', async () => {
    const user = await createTestUser({ email: 'frank@example.com' })
    const result = await getMe(user.id)
    expect(result.email).toBe('frank@example.com')
  })
})
