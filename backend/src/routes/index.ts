import { Hono } from 'hono'
import { authRoutes } from './auth.js'
import { webauthnRoutes } from './webauthn.js'
import { oauthRoutes } from './oauth.js'
import { clubRoutes } from './clubs.js'
import { calendarRoutes } from './calendars.js'
import { propertyRoutes } from './properties.js'
import { featureRoutes } from './features.js'
import { targetGroupRoutes } from './targetGroups.js'
import { locationRoutes } from './locations.js'
import { templateRoutes } from './eventTemplates.js'
import { feedRoutes } from './feeds.js'
import { eventRoutes } from './events.js'
import { publicRoutes } from './public.js'

export const routes = new Hono()

routes.get('/health', (c) => c.json({ ok: true }))
routes.route('/api/auth', authRoutes)
routes.route('/api/auth/webauthn', webauthnRoutes)
routes.route('/api/auth/oauth', oauthRoutes)
routes.route('/api/clubs', clubRoutes)
routes.route('/api/clubs/:clubId/calendars', calendarRoutes)
routes.route('/api/calendars/:calendarId/properties', propertyRoutes)
routes.route('/api/calendars/:calendarId/features', featureRoutes)
routes.route('/api/calendars/:calendarId/target-groups', targetGroupRoutes)
routes.route('/api/calendars/:calendarId/locations', locationRoutes)
routes.route('/api/calendars/:calendarId/templates', templateRoutes)
routes.route('/api/calendars/:calendarId/feeds', feedRoutes)
routes.route('/api/calendars/:calendarId/events', eventRoutes)
routes.route('/api/feed', publicRoutes)
