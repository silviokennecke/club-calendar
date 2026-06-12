import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { requireCalendarMember } from '../middleware/requireCalendar.js'
import {
  listEvents, createEvent, createSeriesFromTemplate,
  getEvent, updateEvent, removeEvent,
} from '../services/eventService.js'

export const eventRoutes = new Hono<{ Variables: { userId: number } }>()

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/
const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const eventSchema = z.object({
  name: z.string().min(1).max(255),
  timezone: z.string().min(1).nullable().optional(),
  date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD'),
  timeBegin: z.string().regex(timeRegex),
  timeEnd: z.string().regex(timeRegex),
  isDraft: z.boolean().optional(),
  locationId: z.number().int().positive().nullable().optional(),
  eventTemplateId: z.number().int().positive().nullable().optional(),
  propertyIds: z.array(z.number().int().positive()).optional(),
  featureIds: z.array(z.number().int().positive()).optional(),
  targetGroupIds: z.array(z.number().int().positive()).optional(),
})

const seriesSchema = z.object({
  templateId: z.number().int().positive(),
  dates: z.array(z.string().regex(dateRegex, 'Must be YYYY-MM-DD')).min(1),
  overrides: z.object({
    isDraft: z.boolean().optional(),
    locationId: z.number().int().positive().nullable().optional(),
    propertyIds: z.array(z.number().int().positive()).optional(),
    featureIds: z.array(z.number().int().positive()).optional(),
    targetGroupIds: z.array(z.number().int().positive()).optional(),
  }).optional(),
})

eventRoutes.get('/', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const { from, to } = c.req.query()
  const events = await listEvents(calendarId, from, to)
  return c.json(events)
})

eventRoutes.post('/from-template', authMiddleware, requireCalendarMember, zValidator('json', seriesSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const { templateId, dates, overrides } = c.req.valid('json')
  const events = await createSeriesFromTemplate(calendarId, templateId, dates, overrides)
  return c.json(events, 201)
})

eventRoutes.post('/', authMiddleware, requireCalendarMember, zValidator('json', eventSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const event = await createEvent(calendarId, c.req.valid('json'))
  return c.json(event, 201)
})

eventRoutes.get('/:id', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  const event = await getEvent(id, calendarId)
  return c.json(event)
})

eventRoutes.patch('/:id', authMiddleware, requireCalendarMember, zValidator('json', eventSchema.partial().refine(d => Object.keys(d).length > 0, 'At least one field required')), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  const event = await updateEvent(id, calendarId, c.req.valid('json'))
  return c.json(event)
})

eventRoutes.delete('/:id', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  await removeEvent(id, calendarId)
  return c.json({ ok: true })
})
