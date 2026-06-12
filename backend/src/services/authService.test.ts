import { describe, it, expect } from 'vitest'
import { login, getMe } from './authService.js'
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
