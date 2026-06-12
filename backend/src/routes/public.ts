import { Hono } from 'hono'
import { getFeedIcs } from '../services/icsService.js'
import { AppError } from '../lib/errors.js'

export const publicRoutes = new Hono()

publicRoutes.get('/:feedId/ics', async (c) => {
  const feedId = Number(c.req.param('feedId'))
  if (isNaN(feedId)) return c.json({ error: 'Not found' }, 404)
  const secret = c.req.query('secret')

  try {
    const ics = await getFeedIcs(feedId, secret)
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
