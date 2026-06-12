import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { requireClubMember } from '../middleware/requireClub.js'
import { listCalendars, createCalendar, updateCalendar, deleteCalendar, verifyCalendarBelongsToClub } from '../services/calendarService.js'

export const calendarRoutes = new Hono<{ Variables: { userId: number } }>()

const calendarSchema = z.object({ name: z.string().min(1).max(255) })

calendarRoutes.get('/', authMiddleware, requireClubMember, async (c) => {
  const calendars = await listCalendars(Number(c.req.param('clubId')))
  return c.json(calendars)
})

calendarRoutes.post('/', authMiddleware, requireClubMember, zValidator('json', calendarSchema), async (c) => {
  const cal = await createCalendar(Number(c.req.param('clubId')), c.req.valid('json'))
  return c.json(cal, 201)
})

calendarRoutes.get('/:calendarId', authMiddleware, requireClubMember, async (c) => {
  const cal = await verifyCalendarBelongsToClub(
    Number(c.req.param('calendarId')),
    Number(c.req.param('clubId')),
  )
  return c.json(cal)
})

calendarRoutes.patch('/:calendarId', authMiddleware, requireClubMember, zValidator('json', calendarSchema.partial()), async (c) => {
  await verifyCalendarBelongsToClub(
    Number(c.req.param('calendarId')),
    Number(c.req.param('clubId')),
  )
  const cal = await updateCalendar(Number(c.req.param('calendarId')), c.req.valid('json'))
  return c.json(cal)
})

calendarRoutes.delete('/:calendarId', authMiddleware, requireClubMember, async (c) => {
  await verifyCalendarBelongsToClub(
    Number(c.req.param('calendarId')),
    Number(c.req.param('clubId')),
  )
  await deleteCalendar(Number(c.req.param('calendarId')))
  return c.json({ ok: true })
})
