import { prisma } from '../lib/prisma.js'
import { notFound } from '../lib/errors.js'

export async function listFeatures(calendarId: number) {
  return prisma.feature.findMany({ where: { calendarId }, orderBy: { name: 'asc' } })
}

export async function createFeature(calendarId: number, data: { name: string }) {
  return prisma.feature.create({ data: { calendarId, ...data } })
}

export async function updateFeature(id: number, calendarId: number, data: { name?: string }) {
  const feature = await prisma.feature.findUnique({ where: { id } })
  if (!feature || feature.calendarId !== calendarId) throw notFound('Feature not found')
  return prisma.feature.update({ where: { id }, data })
}

export async function removeFeature(id: number, calendarId: number) {
  const feature = await prisma.feature.findUnique({ where: { id } })
  if (!feature || feature.calendarId !== calendarId) throw notFound('Feature not found')
  await prisma.feature.delete({ where: { id } })
}
