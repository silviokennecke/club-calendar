import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { requireCalendarMember } from '../middleware/requireCalendar.js'
import { listLocations, createLocation, updateLocation, removeLocation } from '../services/locationService.js'

export const locationRoutes = new Hono<{ Variables: { userId: number } }>()

const locationSchema = z.object({
  address: z.string().min(1).max(500),
})

locationRoutes.get('/', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const locations = await listLocations(calendarId)
  return c.json(locations)
})

locationRoutes.post('/', authMiddleware, requireCalendarMember, zValidator('json', locationSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const location = await createLocation(calendarId, c.req.valid('json'))
  return c.json(location, 201)
})

const patchLocationSchema = locationSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

locationRoutes.patch('/:id', authMiddleware, requireCalendarMember, zValidator('json', patchLocationSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  const location = await updateLocation(id, calendarId, c.req.valid('json'))
  return c.json(location)
})

locationRoutes.delete('/:id', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  await removeLocation(id, calendarId)
  return c.json({ ok: true })
})
