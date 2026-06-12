import { prisma } from '../lib/prisma.js'
import { notFound } from '../lib/errors.js'

export async function listTargetGroups(calendarId: number) {
  return prisma.targetGroup.findMany({ where: { calendarId }, orderBy: { name: 'asc' } })
}

export async function createTargetGroup(calendarId: number, data: { name: string }) {
  return prisma.targetGroup.create({ data: { calendarId, ...data } })
}

export async function updateTargetGroup(id: number, calendarId: number, data: { name?: string }) {
  const group = await prisma.targetGroup.findUnique({ where: { id } })
  if (!group || group.calendarId !== calendarId) throw notFound('Target group not found')
  return prisma.targetGroup.update({ where: { id }, data })
}

export async function removeTargetGroup(id: number, calendarId: number) {
  const group = await prisma.targetGroup.findUnique({ where: { id } })
  if (!group || group.calendarId !== calendarId) throw notFound('Target group not found')
  await prisma.targetGroup.delete({ where: { id } })
}
