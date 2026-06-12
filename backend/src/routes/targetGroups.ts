import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { requireCalendarMember } from '../middleware/requireCalendar.js'
import { listTargetGroups, createTargetGroup, updateTargetGroup, removeTargetGroup } from '../services/targetGroupService.js'

export const targetGroupRoutes = new Hono<{ Variables: { userId: number } }>()

const targetGroupSchema = z.object({
  name: z.string().min(1).max(255),
})

targetGroupRoutes.get('/', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const groups = await listTargetGroups(calendarId)
  return c.json(groups)
})

targetGroupRoutes.post('/', authMiddleware, requireCalendarMember, zValidator('json', targetGroupSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const group = await createTargetGroup(calendarId, c.req.valid('json'))
  return c.json(group, 201)
})

const patchTargetGroupSchema = targetGroupSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

targetGroupRoutes.patch('/:id', authMiddleware, requireCalendarMember, zValidator('json', patchTargetGroupSchema), async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  const group = await updateTargetGroup(id, calendarId, c.req.valid('json'))
  return c.json(group)
})

targetGroupRoutes.delete('/:id', authMiddleware, requireCalendarMember, async (c) => {
  const calendarId = Number(c.req.param('calendarId'))
  const id = Number(c.req.param('id'))
  await removeTargetGroup(id, calendarId)
  return c.json({ ok: true })
})
