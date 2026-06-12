import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { requireCalendarMember } from '../middleware/requireCalendar.js'
import { listFeatures, createFeature, updateFeature, removeFeature } from '../services/featureService.js'

export const featureRoutes = new Hono<{ Variables: { userId: number } }>()

const featureSchema = z.object({
  name: z.string().min(1).max(255),
})

featureRoutes.get('/', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const features = await listFeatures(calendarId)
  return c.json(features)
})

featureRoutes.post('/', authMiddleware, requireCalendarMember, zValidator('json', featureSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const feature = await createFeature(calendarId, c.req.valid('json'))
  return c.json(feature, 201)
})

const patchFeatureSchema = featureSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

featureRoutes.patch('/:id', authMiddleware, requireCalendarMember, zValidator('json', patchFeatureSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  const feature = await updateFeature(id, calendarId, c.req.valid('json'))
  return c.json(feature)
})

featureRoutes.delete('/:id', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  await removeFeature(id, calendarId)
  return c.json({ ok: true })
})
