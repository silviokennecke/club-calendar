import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { requireCalendarMember } from '../middleware/requireCalendar.js'
import {
  listEvents, createEvent, createSeriesFromTemplate, importEvents,
  getEvent, updateEvent, removeEvent,
} from '../services/eventService.js'

export const eventRoutes = new Hono<{ Variables: { userId: number } }>()

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/
const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const eventSchema = z.object({
  name: z.string().min(1).max(255),
  timezone: z.string().min(1).nullable().optional(),
  date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD'),
  dateEnd: z.string().regex(dateRegex, 'Must be YYYY-MM-DD').nullable().optional(),
  timeBegin: z.string().regex(timeRegex),
  timeEnd: z.string().regex(timeRegex),
  isAllDay: z.boolean().optional(),
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
  const { from, to, targetGroupIds: tgParam } = c.req.query()
  if (from && isNaN(Date.parse(from))) return c.json({ error: 'Invalid from date' }, 400)
  if (to && isNaN(Date.parse(to))) return c.json({ error: 'Invalid to date' }, 400)
  const targetGroupIds = tgParam ? tgParam.split(',').map(Number).filter(n => !isNaN(n)) : undefined
  const events = await listEvents(calendarId, from, to, targetGroupIds)
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

const importSchema = z.object({
  events: z.array(z.object({
    name: z.string().min(1).max(255),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    timeBegin: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timeEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    isAllDay: z.boolean().optional(),
    timezone: z.string().nullable().optional(),
    isDraft: z.boolean().optional(),
    locationId: z.number().int().positive().nullable().optional(),
    propertyIds: z.array(z.number().int().positive()).optional(),
    featureIds: z.array(z.number().int().positive()).optional(),
    targetGroupIds: z.array(z.number().int().positive()).optional(),
  })).min(1).max(500),
})

eventRoutes.post('/import', authMiddleware, requireCalendarMember, zValidator('json', importSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const { events } = c.req.valid('json')
  const created = await importEvents(calendarId, events)
  return c.json({ imported: created.length }, 201)
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
