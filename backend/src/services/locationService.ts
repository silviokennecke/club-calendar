import { prisma } from '../lib/prisma.js'
import { notFound } from '../lib/errors.js'

export async function listLocations(calendarId: number) {
  return prisma.location.findMany({ where: { calendarId }, orderBy: { address: 'asc' } })
}

export async function createLocation(calendarId: number, data: { address: string; latitude?: number | null; longitude?: number | null }) {
  return prisma.location.create({ data: { calendarId, ...data } })
}

export async function updateLocation(id: number, calendarId: number, data: { address?: string; latitude?: number | null; longitude?: number | null }) {
  const location = await prisma.location.findUnique({ where: { id } })
  if (!location || location.calendarId !== calendarId) throw notFound('Location not found')
  return prisma.location.update({ where: { id }, data })
}

export async function removeLocation(id: number, calendarId: number) {
  const location = await prisma.location.findUnique({ where: { id } })
  if (!location || location.calendarId !== calendarId) throw notFound('Location not found')
  await prisma.location.delete({ where: { id } })
}
