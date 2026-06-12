import { prisma } from '../lib/prisma.js'
import { notFound } from '../lib/errors.js'

export async function listProperties(calendarId: number) {
  return prisma.property.findMany({ where: { calendarId }, orderBy: { name: 'asc' } })
}

export async function createProperty(calendarId: number, data: { name: string; icon?: string | null }) {
  return prisma.property.create({ data: { calendarId, ...data } })
}

export async function updateProperty(id: number, calendarId: number, data: { name?: string; icon?: string | null }) {
  const prop = await prisma.property.findUnique({ where: { id } })
  if (!prop || prop.calendarId !== calendarId) throw notFound('Property not found')
  return prisma.property.update({ where: { id }, data })
}

export async function removeProperty(id: number, calendarId: number) {
  const prop = await prisma.property.findUnique({ where: { id } })
  if (!prop || prop.calendarId !== calendarId) throw notFound('Property not found')
  await prisma.property.delete({ where: { id } })
}
