import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { notFound } from '../lib/errors'

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  listFeatures(calendarId: number) {
    return this.prisma.feature.findMany({ where: { calendarId }, orderBy: { name: 'asc' } })
  }

  createFeature(calendarId: number, data: { name: string }) {
    return this.prisma.feature.create({ data: { calendarId, ...data } })
  }

  async updateFeature(id: number, calendarId: number, data: { name?: string }) {
    const feature = await this.prisma.feature.findUnique({ where: { id } })
    if (!feature || feature.calendarId !== calendarId) throw notFound('Feature not found')
    return this.prisma.feature.update({ where: { id }, data })
  }

  async removeFeature(id: number, calendarId: number) {
    const feature = await this.prisma.feature.findUnique({ where: { id } })
    if (!feature || feature.calendarId !== calendarId) throw notFound('Feature not found')
    await this.prisma.feature.delete({ where: { id } })
  }
}
