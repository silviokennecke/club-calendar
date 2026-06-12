import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, ParseIntPipe } from '@nestjs/common'
import { z } from 'zod'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ClubMemberGuard } from '../common/guards/club-member.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { CalendarsService } from './calendars.service'

const calendarSchema = z.object({
  name: z.string().min(1).max(255),
  timezone: z.string().max(100).nullable().optional(),
})

const calendarPatchSchema = calendarSchema.partial()

@Controller('api/clubs/:clubId/calendars')
@UseGuards(JwtAuthGuard, ClubMemberGuard)
export class CalendarsController {
  constructor(private readonly calendars: CalendarsService) {}

  @Get()
  list(@Param('clubId', ParseIntPipe) clubId: number) {
    return this.calendars.listCalendars(clubId)
  }

  @Post()
  @HttpCode(201)
  create(@Param('clubId', ParseIntPipe) clubId: number, @Body(new ZodValidationPipe(calendarSchema)) dto: any) {
    return this.calendars.createCalendar(clubId, dto)
  }

  @Get(':calendarId')
  async getOne(@Param('clubId', ParseIntPipe) clubId: number, @Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.calendars.verifyCalendarBelongsToClub(calendarId, clubId)
  }

  @Patch(':calendarId')
  async update(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(calendarPatchSchema)) dto: any,
  ) {
    await this.calendars.verifyCalendarBelongsToClub(calendarId, clubId)
    return this.calendars.updateCalendar(calendarId, dto)
  }

  @Delete(':calendarId')
  @HttpCode(200)
  async remove(@Param('clubId', ParseIntPipe) clubId: number, @Param('calendarId', ParseIntPipe) calendarId: number) {
    await this.calendars.verifyCalendarBelongsToClub(calendarId, clubId)
    await this.calendars.deleteCalendar(calendarId)
    return { ok: true }
  }
}
