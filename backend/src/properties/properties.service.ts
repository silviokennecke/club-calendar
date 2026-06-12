import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { notFound } from '../lib/errors'

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  listProperties(calendarId: number) {
    return this.prisma.property.findMany({ where: { calendarId }, orderBy: { name: 'asc' } })
  }

  createProperty(calendarId: number, data: { name: string; icon?: string | null }) {
    return this.prisma.property.create({ data: { calendarId, ...data } })
  }

  async updateProperty(id: number, calendarId: number, data: { name?: string; icon?: string | null }) {
    const prop = await this.prisma.property.findUnique({ where: { id } })
    if (!prop || prop.calendarId !== calendarId) throw notFound('Property not found')
    return this.prisma.property.update({ where: { id }, data })
  }

  async removeProperty(id: number, calendarId: number) {
    const prop = await this.prisma.property.findUnique({ where: { id } })
    if (!prop || prop.calendarId !== calendarId) throw notFound('Property not found')
    await this.prisma.property.delete({ where: { id } })
  }
}
