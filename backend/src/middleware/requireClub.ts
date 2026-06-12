import { createMiddleware } from 'hono/factory'
import { prisma } from '../lib/prisma.js'
import { forbidden } from '../lib/errors.js'

export const requireClubMember = createMiddleware<{
  Variables: { userId: number }
}>(async (c, next) => {
  const userId = c.get('userId')
  const clubId = Number(c.req.param('clubId'))
  if (isNaN(clubId)) throw forbidden()
  const membership = await prisma.clubUser.findUnique({
    where: { clubId_userId: { clubId, userId } },
  })
  if (!membership) throw forbidden()
  await next()
})
