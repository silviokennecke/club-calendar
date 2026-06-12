import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { notFound } from '../lib/errors'

@Injectable()
export class EventTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  listTemplates(calendarId: number) {
    return this.prisma.eventTemplate.findMany({
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

  createTemplate(calendarId: number, data: {
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
    return this.prisma.eventTemplate.create({
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

  async getTemplate(id: number, calendarId: number) {
    const template = await this.prisma.eventTemplate.findUnique({
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

  async updateTemplate(id: number, calendarId: number, data: {
    name?: string
    timezone?: string
    timeBegin?: string
    timeEnd?: string
    locationId?: number | null
    propertyIds?: number[]
    featureIds?: number[]
    targetGroupIds?: number[]
  }) {
    const existing = await this.prisma.eventTemplate.findUnique({ where: { id } })
    if (!existing || existing.calendarId !== calendarId) throw notFound('Template not found')
    const { propertyIds, featureIds, targetGroupIds, ...rest } = data
    return this.prisma.$transaction(async (tx) => {
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

  async removeTemplate(id: number, calendarId: number) {
    const template = await this.prisma.eventTemplate.findUnique({ where: { id } })
    if (!template || template.calendarId !== calendarId) throw notFound('Template not found')
    await this.prisma.eventTemplate.delete({ where: { id } })
  }
}
