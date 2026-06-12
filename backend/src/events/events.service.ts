import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { notFound } from '../lib/errors'

interface EventData {
  name: string
  timezone?: string | null
  date: string
  dateEnd?: string | null
  timeBegin: string
  timeEnd: string
  isAllDay?: boolean
  isDraft?: boolean
  locationId?: number | null
  eventTemplateId?: number | null
  propertyIds?: number[]
  featureIds?: number[]
  targetGroupIds?: number[]
}

interface ImportEventData {
  name: string
  date: string
  dateEnd?: string | null
  timeBegin: string
  timeEnd: string
  isAllDay?: boolean
  timezone?: string | null
  isDraft?: boolean
  locationId?: number | null
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

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  listEvents(calendarId: number, from?: string, to?: string, targetGroupIds?: number[]) {
    return this.prisma.event.findMany({
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

  createEvent(calendarId: number, data: EventData) {
    const { propertyIds = [], featureIds = [], targetGroupIds = [], date, dateEnd, ...rest } = data
    return this.prisma.event.create({
      data: {
        calendarId,
        ...rest,
        date: new Date(date),
        dateEnd: dateEnd ? new Date(dateEnd) : null,
        properties: { create: propertyIds.map((propertyId) => ({ propertyId })) },
        features: { create: featureIds.map((featureId) => ({ featureId })) },
        targetGroups: { create: targetGroupIds.map((targetGroupId) => ({ targetGroupId })) },
      },
      include: eventInclude,
    })
  }

  async createSeriesFromTemplate(
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
    const template = await this.prisma.eventTemplate.findUnique({
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

    const propertyIds = overrides?.propertyIds ?? template.properties.map((p) => p.propertyId)
    const featureIds = overrides?.featureIds ?? template.features.map((f) => f.featureId)
    const targetGroupIds = overrides?.targetGroupIds ?? template.targetGroups.map((t) => t.targetGroupId)
    const locationId = overrides?.locationId !== undefined ? overrides.locationId : template.locationId
    const isDraft = overrides?.isDraft ?? true

    return this.prisma.$transaction(
      dates.map((dateStr) =>
        this.prisma.event.create({
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

  importEvents(calendarId: number, events: ImportEventData[]) {
    return this.prisma.$transaction(
      events.map(({ propertyIds = [], featureIds = [], targetGroupIds = [], date, dateEnd, ...rest }) =>
        this.prisma.event.create({
          data: {
            calendarId,
            ...rest,
            date: new Date(date),
            dateEnd: dateEnd ? new Date(dateEnd) : null,
            properties: { create: propertyIds.map((propertyId) => ({ propertyId })) },
            features: { create: featureIds.map((featureId) => ({ featureId })) },
            targetGroups: { create: targetGroupIds.map((targetGroupId) => ({ targetGroupId })) },
          },
          include: eventInclude,
        }),
      ),
    )
  }

  async getEvent(id: number, calendarId: number) {
    const event = await this.prisma.event.findUnique({ where: { id }, include: eventInclude })
    if (!event || event.calendarId !== calendarId) throw notFound('Event not found')
    return event
  }

  async updateEvent(id: number, calendarId: number, data: Partial<EventData>) {
    const existing = await this.prisma.event.findUnique({ where: { id } })
    if (!existing || existing.calendarId !== calendarId) throw notFound('Event not found')
    const { propertyIds, featureIds, targetGroupIds, date, dateEnd, ...rest } = data
    return this.prisma.$transaction(async (tx) => {
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
        data: {
          ...rest,
          ...(date ? { date: new Date(date) } : {}),
          ...(dateEnd !== undefined ? { dateEnd: dateEnd ? new Date(dateEnd) : null } : {}),
        },
        include: eventInclude,
      })
    })
  }

  async removeEvent(id: number, calendarId: number) {
    const event = await this.prisma.event.findUnique({ where: { id } })
    if (!event || event.calendarId !== calendarId) throw notFound('Event not found')
    await this.prisma.event.delete({ where: { id } })
  }
}
