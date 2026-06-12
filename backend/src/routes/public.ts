import { Hono } from 'hono'
import { getFeedIcs, getFeedEvents } from '../services/icsService.js'
import { AppError } from '../lib/errors.js'

export const publicRoutes = new Hono()

publicRoutes.get('/:feedId/events', async (c) => {
  const feedId = Number(c.req.param('feedId'))
  if (isNaN(feedId)) return c.json({ error: 'Not found' }, 404)
  const secret = c.req.query('secret')
  const tgParam = c.req.query('targetGroupIds')
  const targetGroupIds = tgParam ? tgParam.split(',').map(Number).filter(n => !isNaN(n)) : undefined

  try {
    const { feed, events } = await getFeedEvents(feedId, secret, targetGroupIds)
    return c.json({ feed: { id: feed.id, name: feed.name }, events })
  } catch (err) {
    if (err instanceof AppError) {
      return c.json({ error: err.message }, err.status as any)
    }
    throw err
  }
})

publicRoutes.get('/:feedId/ics', async (c) => {
  const feedId = Number(c.req.param('feedId'))
  if (isNaN(feedId)) return c.json({ error: 'Not found' }, 404)
  const secret = c.req.query('secret')
  const tgParam = c.req.query('targetGroupIds')
  const targetGroupIds = tgParam ? tgParam.split(',').map(Number).filter(n => !isNaN(n)) : undefined

  try {
    const ics = await getFeedIcs(feedId, secret, targetGroupIds)
    return c.body(ics, 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="feed-${feedId}.ics"`,
      'Cache-Control': 'no-cache, no-store',
    })
  } catch (err) {
    if (err instanceof AppError) {
      return c.json({ error: err.message }, err.status as any)
    }
    throw err
  }
})
