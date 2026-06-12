import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { register, login, refresh, getMe } from '../services/authService.js'
import { authMiddleware } from '../middleware/auth.js'
import { enabledProviders } from '../env.js'

export const authRoutes = new Hono()

const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8),
})

authRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
  const { name, email, password } = c.req.valid('json')
  const result = await register(name, email, password)
  setCookie(c, 'refreshToken', result.refreshToken, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/api/auth/refresh',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60,
  })
  return c.json({ accessToken: result.accessToken, user: result.user }, 201)
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')
  const result = await login(email, password)
  setCookie(c, 'refreshToken', result.refreshToken, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/api/auth/refresh',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60,
  })
  return c.json({ accessToken: result.accessToken, user: result.user })
})

authRoutes.post('/refresh', async (c) => {
  const token = getCookie(c, 'refreshToken')
  if (!token) {
    return c.json({ error: 'No refresh token' }, 401)
  }
  const result = await refresh(token)
  return c.json(result)
})

authRoutes.post('/logout', (c) => {
  deleteCookie(c, 'refreshToken', { path: '/api/auth/refresh' })
  return c.json({ ok: true })
})

authRoutes.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const user = await getMe(userId)
  return c.json(user)
})

authRoutes.get('/providers', (c) => c.json(enabledProviders))
