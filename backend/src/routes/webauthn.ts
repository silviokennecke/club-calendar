import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import {
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
  deletePasskey,
} from '../services/passkeyService.js'

export const webauthnRoutes = new Hono<{ Variables: { userId: number } }>()

// Registration (requires logged-in user)
webauthnRoutes.get('/register/options', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const result = await getRegistrationOptions(userId)
  return c.json(result)
})

webauthnRoutes.post(
  '/register/verify',
  authMiddleware,
  zValidator(
    'json',
    z.object({
      challengeToken: z.string(),
      response: z.any(),
      deviceName: z.string().optional(),
    }),
  ),
  async (c) => {
    const userId = c.get('userId')
    const { challengeToken, response, deviceName } = c.req.valid('json')
    const result = await verifyRegistration(userId, challengeToken, response, deviceName)
    return c.json(result)
  },
)

// Authentication (no auth needed)
webauthnRoutes.get('/authenticate/options', async (c) => {
  const result = await getAuthenticationOptions()
  return c.json(result)
})

webauthnRoutes.post(
  '/authenticate/verify',
  zValidator(
    'json',
    z.object({
      challengeToken: z.string(),
      response: z.any(),
    }),
  ),
  async (c) => {
    const { challengeToken, response } = c.req.valid('json')
    const result = await verifyAuthentication(challengeToken, response)
    setCookie(c, 'refreshToken', result.refreshToken, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/api/auth/refresh',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60,
    })
    return c.json({ accessToken: result.accessToken, user: result.user })
  },
)

// Delete passkey (requires auth)
webauthnRoutes.delete('/:id', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  await deletePasskey(id, userId)
  return c.json({ ok: true })
})
