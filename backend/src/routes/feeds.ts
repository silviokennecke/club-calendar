import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { requireCalendarMember } from '../middleware/requireCalendar.js'
import { listFeeds, createFeed, updateFeed, removeFeed, regenerateSecret } from '../services/feedService.js'

export const feedRoutes = new Hono<{ Variables: { userId: number } }>()

const createFeedSchema = z.object({
  name: z.string().min(1).max(255),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PRIVATE'),
  isDraft: z.boolean().optional(),
  targetGroupIds: z.array(z.number().int().positive()).optional(),
})

const updateFeedSchema = createFeedSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

feedRoutes.get('/', authMiddleware, requireCalendarMember, async (c) => {
  const feeds = await listFeeds(Number(c.req.param('calendarId')))
  return c.json(feeds)
})

feedRoutes.post('/', authMiddleware, requireCalendarMember, zValidator('json', createFeedSchema), async (c) => {
  const feed = await createFeed(Number(c.req.param('calendarId')), c.req.valid('json'))
  return c.json(feed, 201)
})

feedRoutes.patch('/:feedId', authMiddleware, requireCalendarMember, zValidator('json', updateFeedSchema), async (c) => {
  const feed = await updateFeed(Number(c.req.param('feedId')), Number(c.req.param('calendarId')), c.req.valid('json'))
  return c.json(feed)
})

feedRoutes.delete('/:feedId', authMiddleware, requireCalendarMember, async (c) => {
  await removeFeed(Number(c.req.param('feedId')), Number(c.req.param('calendarId')))
  return c.json({ ok: true })
})

feedRoutes.post('/:feedId/regenerate-secret', authMiddleware, requireCalendarMember, async (c) => {
  const feed = await regenerateSecret(Number(c.req.param('feedId')), Number(c.req.param('calendarId')))
  return c.json(feed)
})
