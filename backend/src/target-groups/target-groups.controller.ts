import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, ParseIntPipe } from '@nestjs/common'
import { z } from 'zod'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CalendarMemberGuard } from '../common/guards/calendar-member.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { TargetGroupsService } from './target-groups.service'

const targetGroupSchema = z.object({
  name: z.string().min(1).max(255),
})

const patchSchema = targetGroupSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

@Controller('api/calendars/:calendarId/target-groups')
@UseGuards(JwtAuthGuard, CalendarMemberGuard)
export class TargetGroupsController {
  constructor(private readonly service: TargetGroupsService) {}

  @Get()
  list(@Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.service.listTargetGroups(calendarId)
  }

  @Post()
  @HttpCode(201)
  create(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(targetGroupSchema)) dto: any,
  ) {
    return this.service.createTargetGroup(calendarId, dto)
  }

  @Patch(':id')
  update(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(patchSchema)) dto: any,
  ) {
    return this.service.updateTargetGroup(id, calendarId, dto)
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.service.removeTargetGroup(id, calendarId)
    return { ok: true }
  }
}
