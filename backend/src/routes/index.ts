import { Hono } from 'hono'
import { authRoutes } from './auth.js'
import { clubRoutes } from './clubs.js'
import { calendarRoutes } from './calendars.js'

export const routes = new Hono()

routes.get('/health', (c) => c.json({ ok: true }))
routes.route('/api/auth', authRoutes)
routes.route('/api/clubs', clubRoutes)
routes.route('/api/clubs/:clubId/calendars', calendarRoutes)
