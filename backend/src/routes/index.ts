import { Hono } from 'hono'
import { authRoutes } from './auth.js'
import { clubRoutes } from './clubs.js'
import { calendarRoutes } from './calendars.js'
import { propertyRoutes } from './properties.js'
import { featureRoutes } from './features.js'
import { targetGroupRoutes } from './targetGroups.js'
import { locationRoutes } from './locations.js'
import { templateRoutes } from './eventTemplates.js'

export const routes = new Hono()

routes.get('/health', (c) => c.json({ ok: true }))
routes.route('/api/auth', authRoutes)
routes.route('/api/clubs', clubRoutes)
routes.route('/api/clubs/:clubId/calendars', calendarRoutes)
routes.route('/api/calendars/:calendarId/properties', propertyRoutes)
routes.route('/api/calendars/:calendarId/features', featureRoutes)
routes.route('/api/calendars/:calendarId/target-groups', targetGroupRoutes)
routes.route('/api/calendars/:calendarId/locations', locationRoutes)
routes.route('/api/calendars/:calendarId/templates', templateRoutes)
