import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { notFound } from '../lib/errors'

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  listLocations(calendarId: number) {
    return this.prisma.location.findMany({ where: { calendarId }, orderBy: { address: 'asc' } })
  }

  createLocation(calendarId: number, data: { name?: string | null; address: string; latitude?: number | null; longitude?: number | null }) {
    return this.prisma.location.create({ data: { calendarId, ...data } })
  }

  async updateLocation(id: number, calendarId: number, data: { name?: string | null; address?: string; latitude?: number | null; longitude?: number | null }) {
    const location = await this.prisma.location.findUnique({ where: { id } })
    if (!location || location.calendarId !== calendarId) throw notFound('Location not found')
    return this.prisma.location.update({ where: { id }, data })
  }

  async removeLocation(id: number, calendarId: number) {
    const location = await this.prisma.location.findUnique({ where: { id } })
    if (!location || location.calendarId !== calendarId) throw notFound('Location not found')
    await this.prisma.location.delete({ where: { id } })
  }
}
