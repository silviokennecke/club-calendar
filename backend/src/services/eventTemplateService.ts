import { prisma } from '../lib/prisma.js'
import { notFound } from '../lib/errors.js'

export async function listTemplates(calendarId: number) {
  return prisma.eventTemplate.findMany({
    where: { calendarId },
    include: {
      location: true,
      properties: { include: { property: true } },
      features: { include: { feature: true } },
      targetGroups: { include: { targetGroup: true } },
    },
    orderBy: { name: 'asc' },
  })
}

export async function createTemplate(calendarId: number, data: {
  name: string
  timezone: string
  timeBegin: string
  timeEnd: string
  locationId?: number | null
  propertyIds?: number[]
  featureIds?: number[]
  targetGroupIds?: number[]
}) {
  const { propertyIds = [], featureIds = [], targetGroupIds = [], ...rest } = data
  return prisma.eventTemplate.create({
    data: {
      calendarId,
      ...rest,
      properties: { create: propertyIds.map((propertyId) => ({ propertyId })) },
      features: { create: featureIds.map((featureId) => ({ featureId })) },
      targetGroups: { create: targetGroupIds.map((targetGroupId) => ({ targetGroupId })) },
    },
    include: {
      location: true,
      properties: { include: { property: true } },
      features: { include: { feature: true } },
      targetGroups: { include: { targetGroup: true } },
    },
  })
}

export async function getTemplate(id: number, calendarId: number) {
  const template = await prisma.eventTemplate.findUnique({
    where: { id },
    include: {
      location: true,
      properties: { include: { property: true } },
      features: { include: { feature: true } },
      targetGroups: { include: { targetGroup: true } },
    },
  })
  if (!template || template.calendarId !== calendarId) throw notFound('Template not found')
  return template
}

export async function updateTemplate(id: number, calendarId: number, data: {
  name?: string
  timezone?: string
  timeBegin?: string
  timeEnd?: string
  locationId?: number | null
  propertyIds?: number[]
  featureIds?: number[]
  targetGroupIds?: number[]
}) {
  const existing = await prisma.eventTemplate.findUnique({ where: { id } })
  if (!existing || existing.calendarId !== calendarId) throw notFound('Template not found')
  const { propertyIds, featureIds, targetGroupIds, ...rest } = data
  return prisma.$transaction(async (tx) => {
    if (propertyIds !== undefined) {
      await tx.eventTemplateProperty.deleteMany({ where: { templateId: id } })
      await tx.eventTemplateProperty.createMany({ data: propertyIds.map((propertyId) => ({ templateId: id, propertyId })) })
    }
    if (featureIds !== undefined) {
      await tx.eventTemplateFeature.deleteMany({ where: { templateId: id } })
      await tx.eventTemplateFeature.createMany({ data: featureIds.map((featureId) => ({ templateId: id, featureId })) })
    }
    if (targetGroupIds !== undefined) {
      await tx.eventTemplateTargetGroup.deleteMany({ where: { templateId: id } })
      await tx.eventTemplateTargetGroup.createMany({ data: targetGroupIds.map((targetGroupId) => ({ templateId: id, targetGroupId })) })
    }
    return tx.eventTemplate.update({
      where: { id },
      data: rest,
      include: {
        location: true,
        properties: { include: { property: true } },
        features: { include: { feature: true } },
        targetGroups: { include: { targetGroup: true } },
      },
    })
  })
}

export async function removeTemplate(id: number, calendarId: number) {
  const template = await prisma.eventTemplate.findUnique({ where: { id } })
  if (!template || template.calendarId !== calendarId) throw notFound('Template not found')
  await prisma.eventTemplate.delete({ where: { id } })
}
