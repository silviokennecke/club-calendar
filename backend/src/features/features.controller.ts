import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, ParseIntPipe } from '@nestjs/common'
import { z } from 'zod'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CalendarMemberGuard } from '../common/guards/calendar-member.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { FeaturesService } from './features.service'

const featureSchema = z.object({
  name: z.string().min(1).max(255),
  icon: z.string().max(32).nullable().optional(),
})

const patchSchema = featureSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

@Controller('api/calendars/:calendarId/features')
@UseGuards(JwtAuthGuard, CalendarMemberGuard)
export class FeaturesController {
  constructor(private readonly service: FeaturesService) {}

  @Get()
  list(@Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.service.listFeatures(calendarId)
  }

  @Post()
  @HttpCode(201)
  create(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(featureSchema)) dto: any,
  ) {
    return this.service.createFeature(calendarId, dto)
  }

  @Patch(':id')
  update(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(patchSchema)) dto: any,
  ) {
    return this.service.updateFeature(id, calendarId, dto)
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.service.removeFeature(id, calendarId)
    return { ok: true }
  }
}
