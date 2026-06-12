import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { requireCalendarMember } from '../middleware/requireCalendar.js'
import { listTemplates, createTemplate, getTemplate, updateTemplate, removeTemplate } from '../services/eventTemplateService.js'

export const templateRoutes = new Hono<{ Variables: { userId: number } }>()

const templateSchema = z.object({
  name: z.string().min(1).max(255),
  timezone: z.string().min(1),
  timeBegin: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  locationId: z.number().int().positive().nullable().optional(),
  propertyIds: z.array(z.number().int().positive()).optional(),
  featureIds: z.array(z.number().int().positive()).optional(),
  targetGroupIds: z.array(z.number().int().positive()).optional(),
})

templateRoutes.get('/', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const templates = await listTemplates(calendarId)
  return c.json(templates)
})

templateRoutes.post('/', authMiddleware, requireCalendarMember, zValidator('json', templateSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const template = await createTemplate(calendarId, c.req.valid('json'))
  return c.json(template, 201)
})

templateRoutes.get('/:id', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  const template = await getTemplate(id, calendarId)
  return c.json(template)
})

const patchTemplateSchema = templateSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

templateRoutes.patch('/:id', authMiddleware, requireCalendarMember, zValidator('json', patchTemplateSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  const template = await updateTemplate(id, calendarId, c.req.valid('json'))
  return c.json(template)
})

templateRoutes.delete('/:id', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  await removeTemplate(id, calendarId)
  return c.json({ ok: true })
})
