import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { notFound, forbidden } from '../lib/errors'

@Injectable()
export class CalendarsService {
  constructor(private readonly prisma: PrismaService) {}

  async listCalendars(clubId: number, includeArchived = false) {
    return this.prisma.calendar.findMany({
      where: {
        clubId,
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [
        { archivedAt: { sort: 'asc', nulls: 'first' } },
        { name: 'asc' },
      ],
    })
  }

  async createCalendar(clubId: number, data: { name: string; timezone?: string | null }) {
    return this.prisma.calendar.create({ data: { clubId, ...data } })
  }

  async getCalendar(calendarId: number) {
    const cal = await this.prisma.calendar.findUnique({ where: { id: calendarId } })
    if (!cal) throw notFound('Calendar not found')
    return cal
  }

  async updateCalendar(calendarId: number, data: { name?: string; timezone?: string | null }) {
    const cal = await this.prisma.calendar.findUnique({ where: { id: calendarId } })
    if (!cal) throw notFound('Calendar not found')
    return this.prisma.calendar.update({ where: { id: calendarId }, data })
  }

  async deleteCalendar(calendarId: number) {
    await this.prisma.calendar.delete({ where: { id: calendarId } })
  }

  async verifyCalendarBelongsToClub(calendarId: number, clubId: number) {
    const cal = await this.prisma.calendar.findUnique({ where: { id: calendarId } })
    if (!cal || cal.clubId !== clubId) throw forbidden('Calendar not found in this club')
    return cal
  }

  async archiveCalendar(calendarId: number, clubId: number) {
    await this.verifyCalendarBelongsToClub(calendarId, clubId)
    return this.prisma.calendar.update({
      where: { id: calendarId },
      data: { archivedAt: new Date() },
    })
  }

  async unarchiveCalendar(calendarId: number, clubId: number) {
    await this.verifyCalendarBelongsToClub(calendarId, clubId)
    return this.prisma.calendar.update({
      where: { id: calendarId },
      data: { archivedAt: null },
    })
  }

  async duplicateCalendar(calendarId: number, clubId: number) {
    const source = await this.prisma.calendar.findUnique({
      where: { id: calendarId },
      include: {
        properties: true,
        features: true,
        targetGroups: true,
        locations: true,
        templates: {
          include: {
            properties: true,
            features: true,
            targetGroups: true,
          },
        },
        feeds: { include: { targetGroups: true } },
      },
    })
    if (!source || source.clubId !== clubId) throw forbidden('Calendar not found in this club')

    return this.prisma.$transaction(async (tx) => {
      const newCal = await tx.calendar.create({
        data: { clubId, name: `Copy of ${source.name}`, timezone: source.timezone, archivedAt: null },
      })

      const propMap = new Map<number, number>()
      for (const p of source.properties) {
        const n = await tx.property.create({ data: { calendarId: newCal.id, name: p.name, icon: p.icon } })
        propMap.set(p.id, n.id)
      }

      const featureMap = new Map<number, number>()
      for (const f of source.features) {
        const n = await tx.feature.create({ data: { calendarId: newCal.id, name: f.name } })
        featureMap.set(f.id, n.id)
      }

      const tgMap = new Map<number, number>()
      for (const tg of source.targetGroups) {
        const n = await tx.targetGroup.create({ data: { calendarId: newCal.id, name: tg.name } })
        tgMap.set(tg.id, n.id)
      }

      const locMap = new Map<number, number>()
      for (const loc of source.locations) {
        const n = await tx.location.create({
          data: {
            calendarId: newCal.id,
            name: loc.name,
            street: loc.street,
            zip: loc.zip,
            city: loc.city,
            country: loc.country,
            latitude: loc.latitude,
            longitude: loc.longitude,
          },
        })
        locMap.set(loc.id, n.id)
      }

      for (const tmpl of source.templates) {
        await tx.eventTemplate.create({
          data: {
            calendarId: newCal.id,
            name: tmpl.name,
            timezone: tmpl.timezone,
            timeBegin: tmpl.timeBegin,
            timeEnd: tmpl.timeEnd,
            locationId: tmpl.locationId != null ? (locMap.get(tmpl.locationId) ?? null) : null,
            properties: { create: tmpl.properties.map((p) => ({ propertyId: propMap.get(p.propertyId)! })) },
            features: { create: tmpl.features.map((f) => ({ featureId: featureMap.get(f.featureId)! })) },
            targetGroups: { create: tmpl.targetGroups.map((tg) => ({ targetGroupId: tgMap.get(tg.targetGroupId)! })) },
          },
        })
      }

      for (const feed of source.feeds) {
        await tx.calendarFeed.create({
          data: {
            calendarId: newCal.id,
            name: feed.name,
            visibility: feed.visibility,
            sharedSecret: randomUUID(),
            targetGroups: {
              create: feed.targetGroups.map((ftg) => ({ targetGroupId: tgMap.get(ftg.targetGroupId)! })),
            },
          },
        })
      }

      return newCal
    })
  }
}
