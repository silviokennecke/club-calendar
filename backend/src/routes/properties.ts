import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { requireCalendarMember } from '../middleware/requireCalendar.js'
import { listProperties, createProperty, updateProperty, removeProperty } from '../services/propertyService.js'

export const propertyRoutes = new Hono<{ Variables: { userId: number } }>()

const propertySchema = z.object({
  name: z.string().min(1).max(255),
  icon: z.string().max(32).nullable().optional(),
})

propertyRoutes.get('/', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const properties = await listProperties(calendarId)
  return c.json(properties)
})

propertyRoutes.post('/', authMiddleware, requireCalendarMember, zValidator('json', propertySchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const property = await createProperty(calendarId, c.req.valid('json'))
  return c.json(property, 201)
})

propertyRoutes.patch('/:id', authMiddleware, requireCalendarMember, zValidator('json', propertySchema.partial()), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  const property = await updateProperty(id, calendarId, c.req.valid('json'))
  return c.json(property)
})

propertyRoutes.delete('/:id', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  await removeProperty(id, calendarId)
  return c.json({ ok: true })
})
