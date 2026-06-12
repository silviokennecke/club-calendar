import { createMiddleware } from 'hono/factory'
import { verifyAccessToken } from '../lib/jwt.js'
import { unauthorized } from '../lib/errors.js'

export const authMiddleware = createMiddleware<{
  Variables: { userId: number }
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) throw unauthorized()
  const token = authHeader.slice(7)
  try {
    const payload = await verifyAccessToken(token)
    c.set('userId', payload.sub)
  } catch {
    throw unauthorized()
  }
  await next()
})
