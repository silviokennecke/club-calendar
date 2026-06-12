import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { notFound } from '../lib/errors'

@Injectable()
export class TargetGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  listTargetGroups(calendarId: number) {
    return this.prisma.targetGroup.findMany({ where: { calendarId }, orderBy: { name: 'asc' } })
  }

  createTargetGroup(calendarId: number, data: { name: string }) {
    return this.prisma.targetGroup.create({ data: { calendarId, ...data } })
  }

  async updateTargetGroup(id: number, calendarId: number, data: { name?: string }) {
    const group = await this.prisma.targetGroup.findUnique({ where: { id } })
    if (!group || group.calendarId !== calendarId) throw notFound('Target group not found')
    return this.prisma.targetGroup.update({ where: { id }, data })
  }

  async removeTargetGroup(id: number, calendarId: number) {
    const group = await this.prisma.targetGroup.findUnique({ where: { id } })
    if (!group || group.calendarId !== calendarId) throw notFound('Target group not found')
    await this.prisma.targetGroup.delete({ where: { id } })
  }
}
