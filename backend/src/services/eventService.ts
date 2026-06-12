import { prisma } from '../lib/prisma.js'
import { notFound } from '../lib/errors.js'

interface EventData {
  name: string
  timezone?: string | null
  date: string // YYYY-MM-DD
  timeBegin: string // HH:MM
  timeEnd: string // HH:MM
  isDraft?: boolean
  locationId?: number | null
  eventTemplateId?: number | null
  propertyIds?: number[]
  featureIds?: number[]
  targetGroupIds?: number[]
}

const eventInclude = {
  location: true,
  template: true,
  properties: { include: { property: true } },
  features: { include: { feature: true } },
  targetGroups: { include: { targetGroup: true } },
} as const

export async function listEvents(calendarId: number, from?: string, to?: string, targetGroupIds?: number[]) {
  return prisma.event.findMany({
    where: {
      calendarId,
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
      ...(targetGroupIds && targetGroupIds.length > 0
        ? { targetGroups: { some: { targetGroupId: { in: targetGroupIds } } } }
        : {}),
    },
    include: eventInclude,
    orderBy: [{ date: 'asc' }, { timeBegin: 'asc' }],
  })
}

export async function createEvent(calendarId: number, data: EventData) {
  const { propertyIds = [], featureIds = [], targetGroupIds = [], date, ...rest } = data
  return prisma.event.create({
    data: {
      calendarId,
      ...rest,
      date: new Date(date),
      properties: { create: propertyIds.map((propertyId) => ({ propertyId })) },
      features: { create: featureIds.map((featureId) => ({ featureId })) },
      targetGroups: { create: targetGroupIds.map((targetGroupId) => ({ targetGroupId })) },
    },
    include: eventInclude,
  })
}

export async function createSeriesFromTemplate(
  calendarId: number,
  templateId: number,
  dates: string[],
  overrides?: {
    isDraft?: boolean
    locationId?: number | null
    propertyIds?: number[]
    featureIds?: number[]
    targetGroupIds?: number[]
  },
) {
  const template = await prisma.eventTemplate.findUnique({
    where: { id: templateId },
    include: {
      properties: true,
      features: true,
      targetGroups: true,
    },
  })
  if (!template || template.calendarId !== calendarId) {
    throw notFound('Template not found')
  }

  const propertyIds =
    overrides?.propertyIds ?? template.properties.map((p) => p.propertyId)
  const featureIds =
    overrides?.featureIds ?? template.features.map((f) => f.featureId)
  const targetGroupIds =
    overrides?.targetGroupIds ?? template.targetGroups.map((t) => t.targetGroupId)
  const locationId =
    overrides?.locationId !== undefined ? overrides.locationId : template.locationId
  const isDraft = overrides?.isDraft ?? true

  return prisma.$transaction(
    dates.map((dateStr) =>
      prisma.event.create({
        data: {
          calendarId,
          eventTemplateId: templateId,
          locationId,
          name: template.name,
          timezone: template.timezone,
          date: new Date(dateStr),
          timeBegin: template.timeBegin,
          timeEnd: template.timeEnd,
          isDraft,
          properties: { create: propertyIds.map((propertyId) => ({ propertyId })) },
          features: { create: featureIds.map((featureId) => ({ featureId })) },
          targetGroups: { create: targetGroupIds.map((targetGroupId) => ({ targetGroupId })) },
        },
        include: eventInclude,
      }),
    ),
  )
}

export async function getEvent(id: number, calendarId: number) {
  const event = await prisma.event.findUnique({ where: { id }, include: eventInclude })
  if (!event || event.calendarId !== calendarId) throw notFound('Event not found')
  return event
}

export async function updateEvent(id: number, calendarId: number, data: Partial<EventData>) {
  const existing = await prisma.event.findUnique({ where: { id } })
  if (!existing || existing.calendarId !== calendarId) throw notFound('Event not found')
  const { propertyIds, featureIds, targetGroupIds, date, ...rest } = data
  return prisma.$transaction(async (tx) => {
    if (propertyIds !== undefined) {
      await tx.eventProperty.deleteMany({ where: { eventId: id } })
      await tx.eventProperty.createMany({ data: propertyIds.map((propertyId) => ({ eventId: id, propertyId })) })
    }
    if (featureIds !== undefined) {
      await tx.eventFeature.deleteMany({ where: { eventId: id } })
      await tx.eventFeature.createMany({ data: featureIds.map((featureId) => ({ eventId: id, featureId })) })
    }
    if (targetGroupIds !== undefined) {
      await tx.eventTargetGroup.deleteMany({ where: { eventId: id } })
      await tx.eventTargetGroup.createMany({ data: targetGroupIds.map((targetGroupId) => ({ eventId: id, targetGroupId })) })
    }
    return tx.event.update({
      where: { id },
      data: { ...rest, ...(date ? { date: new Date(date) } : {}) },
      include: eventInclude,
    })
  })
}

export async function removeEvent(id: number, calendarId: number) {
  const event = await prisma.event.findUnique({ where: { id } })
  if (!event || event.calendarId !== calendarId) throw notFound('Event not found')
  await prisma.event.delete({ where: { id } })
}
