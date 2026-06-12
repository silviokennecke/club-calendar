import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, HttpCode, ParseIntPipe, BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CalendarMemberGuard } from '../common/guards/calendar-member.guard'
import { ArchivedCalendarGuard } from '../common/guards/archived-calendar.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { EventsService } from './events.service'

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/
const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const eventSchema = z.object({
  name: z.string().min(1).max(255),
  timezone: z.string().min(1).nullable().optional(),
  date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD'),
  dateEnd: z.string().regex(dateRegex, 'Must be YYYY-MM-DD').nullable().optional(),
  timeBegin: z.string().regex(timeRegex),
  timeEnd: z.string().regex(timeRegex),
  isAllDay: z.boolean().optional(),
  isDraft: z.boolean().optional(),
  locationId: z.number().int().positive().nullable().optional(),
  eventTemplateId: z.number().int().positive().nullable().optional(),
  propertyIds: z.array(z.number().int().positive()).optional(),
  featureIds: z.array(z.number().int().positive()).optional(),
  targetGroupIds: z.array(z.number().int().positive()).optional(),
})

const seriesSchema = z.object({
  templateId: z.number().int().positive(),
  dates: z.array(z.string().regex(dateRegex, 'Must be YYYY-MM-DD')).min(1),
  overrides: z.object({
    isDraft: z.boolean().optional(),
    locationId: z.number().int().positive().nullable().optional(),
    propertyIds: z.array(z.number().int().positive()).optional(),
    featureIds: z.array(z.number().int().positive()).optional(),
    targetGroupIds: z.array(z.number().int().positive()).optional(),
  }).optional(),
})

const importSchema = z.object({
  events: z.array(z.object({
    name: z.string().min(1).max(255),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    timeBegin: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timeEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    isAllDay: z.boolean().optional(),
    timezone: z.string().nullable().optional(),
    isDraft: z.boolean().optional(),
    locationId: z.number().int().positive().nullable().optional(),
    propertyIds: z.array(z.number().int().positive()).optional(),
    featureIds: z.array(z.number().int().positive()).optional(),
    targetGroupIds: z.array(z.number().int().positive()).optional(),
  })).min(1).max(500),
})

const patchEventSchema = eventSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  'At least one field required',
)

@Controller('api/calendars/:calendarId/events')
@UseGuards(JwtAuthGuard, CalendarMemberGuard, ArchivedCalendarGuard)
export class EventsController {
  constructor(private readonly service: EventsService) {}

  @Get()
  list(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('targetGroupIds') tgParam?: string,
  ) {
    if (from && isNaN(Date.parse(from))) throw new BadRequestException('Invalid from date')
    if (to && isNaN(Date.parse(to))) throw new BadRequestException('Invalid to date')
    const targetGroupIds = tgParam ? tgParam.split(',').map(Number).filter((n) => !isNaN(n)) : undefined
    return this.service.listEvents(calendarId, from, to, targetGroupIds)
  }

  @Post('from-template')
  @HttpCode(201)
  createFromTemplate(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(seriesSchema)) dto: any,
  ) {
    const { templateId, dates, overrides } = dto
    return this.service.createSeriesFromTemplate(calendarId, templateId, dates, overrides)
  }

  @Post('import')
  @HttpCode(201)
  async importEvents(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(importSchema)) dto: any,
  ) {
    const created = await this.service.importEvents(calendarId, dto.events)
    return { imported: created.length }
  }

  @Post()
  @HttpCode(201)
  create(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(eventSchema)) dto: any,
  ) {
    return this.service.createEvent(calendarId, dto)
  }

  @Get(':id')
  getOne(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.getEvent(id, calendarId)
  }

  @Patch(':id')
  update(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(patchEventSchema)) dto: any,
  ) {
    return this.service.updateEvent(id, calendarId, dto)
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.service.removeEvent(id, calendarId)
    return { ok: true }
  }
}
