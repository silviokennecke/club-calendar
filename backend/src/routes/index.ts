import { Hono } from 'hono'
import { authRoutes } from './auth.js'

export const routes = new Hono()

routes.get('/health', (c) => c.json({ ok: true }))
routes.route('/api/auth', authRoutes)
