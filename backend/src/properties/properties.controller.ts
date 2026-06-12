import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, ParseIntPipe } from '@nestjs/common'
import { z } from 'zod'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CalendarMemberGuard } from '../common/guards/calendar-member.guard'
import { ArchivedCalendarGuard } from '../common/guards/archived-calendar.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { PropertiesService } from './properties.service'

const propertySchema = z.object({
  name: z.string().min(1).max(255),
  icon: z.string().max(32).nullable().optional(),
})

const patchSchema = propertySchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

@Controller('api/calendars/:calendarId/properties')
@UseGuards(JwtAuthGuard, CalendarMemberGuard, ArchivedCalendarGuard)
export class PropertiesController {
  constructor(private readonly service: PropertiesService) {}

  @Get()
  list(@Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.service.listProperties(calendarId)
  }

  @Post()
  @HttpCode(201)
  create(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(propertySchema)) dto: any,
  ) {
    return this.service.createProperty(calendarId, dto)
  }

  @Patch(':id')
  update(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(patchSchema)) dto: any,
  ) {
    return this.service.updateProperty(id, calendarId, dto)
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.service.removeProperty(id, calendarId)
    return { ok: true }
  }
}
