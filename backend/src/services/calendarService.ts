import { prisma } from '../lib/prisma.js'
import { notFound, forbidden } from '../lib/errors.js'

export async function listCalendars(clubId: number) {
  return prisma.calendar.findMany({
    where: { clubId },
    orderBy: { name: 'asc' },
  })
}

export async function createCalendar(clubId: number, data: { name: string }) {
  return prisma.calendar.create({ data: { clubId, ...data } })
}

export async function getCalendar(calendarId: number) {
  const cal = await prisma.calendar.findUnique({ where: { id: calendarId } })
  if (!cal) throw notFound('Calendar not found')
  return cal
}

export async function updateCalendar(calendarId: number, data: { name?: string }) {
  const cal = await prisma.calendar.findUnique({ where: { id: calendarId } })
  if (!cal) throw notFound('Calendar not found')
  return prisma.calendar.update({ where: { id: calendarId }, data })
}

export async function deleteCalendar(calendarId: number) {
  await prisma.calendar.delete({ where: { id: calendarId } })
}

export async function verifyCalendarBelongsToClub(calendarId: number, clubId: number) {
  const cal = await prisma.calendar.findUnique({ where: { id: calendarId } })
  if (!cal || cal.clubId !== clubId) throw forbidden('Calendar not found in this club')
  return cal
}
