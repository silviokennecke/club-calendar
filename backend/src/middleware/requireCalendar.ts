import { createMiddleware } from 'hono/factory'
import { prisma } from '../lib/prisma.js'
import { forbidden, notFound } from '../lib/errors.js'

export const requireCalendarMember = createMiddleware<{
  Variables: { userId: number }
}>(async (c, next) => {
  const userId = c.get('userId')
  const calendarId = Number(c.req.param('calendarId'))
  if (isNaN(calendarId)) throw notFound('Calendar not found')
  const calendar = await prisma.calendar.findUnique({
    where: { id: calendarId },
    include: { club: { include: { users: { where: { userId } } } } },
  })
  if (!calendar) throw notFound('Calendar not found')
  if (calendar.club.users.length === 0) throw forbidden()
  await next()
})
