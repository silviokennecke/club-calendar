import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { notFound } from '../lib/errors'

interface LocationData {
  name?: string | null
  street?: string | null
  zip?: string | null
  city?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  listLocations(calendarId: number) {
    return this.prisma.location.findMany({ where: { calendarId }, orderBy: { name: 'asc' } })
  }

  createLocation(calendarId: number, data: LocationData) {
    return this.prisma.location.create({ data: { calendarId, ...data } })
  }

  async updateLocation(id: number, calendarId: number, data: LocationData) {
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
