import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { notFound, forbidden } from '../lib/errors'

@Injectable()
export class CalendarsService {
  constructor(private readonly prisma: PrismaService) {}

  async listCalendars(clubId: number) {
    return this.prisma.calendar.findMany({
      where: { clubId },
      orderBy: { name: 'asc' },
    })
  }

  async createCalendar(clubId: number, data: { name: string }) {
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
}
