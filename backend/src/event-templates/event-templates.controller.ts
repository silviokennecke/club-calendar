import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, ParseIntPipe } from '@nestjs/common'
import { z } from 'zod'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CalendarMemberGuard } from '../common/guards/calendar-member.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { EventTemplatesService } from './event-templates.service'

const templateSchema = z.object({
  name: z.string().min(1).max(255),
  timezone: z.string().min(1),
  timeBegin: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  locationId: z.number().int().positive().nullable().optional(),
  propertyIds: z.array(z.number().int().positive()).optional(),
  featureIds: z.array(z.number().int().positive()).optional(),
  targetGroupIds: z.array(z.number().int().positive()).optional(),
})

const patchTemplateSchema = templateSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

@Controller('api/calendars/:calendarId/templates')
@UseGuards(JwtAuthGuard, CalendarMemberGuard)
export class EventTemplatesController {
  constructor(private readonly service: EventTemplatesService) {}

  @Get()
  list(@Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.service.listTemplates(calendarId)
  }

  @Post()
  @HttpCode(201)
  create(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(templateSchema)) dto: any,
  ) {
    return this.service.createTemplate(calendarId, dto)
  }

  @Get(':id')
  getOne(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.getTemplate(id, calendarId)
  }

  @Patch(':id')
  update(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(patchTemplateSchema)) dto: any,
  ) {
    return this.service.updateTemplate(id, calendarId, dto)
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.service.removeTemplate(id, calendarId)
    return { ok: true }
  }
}
