import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, ParseIntPipe } from '@nestjs/common'
import { z } from 'zod'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CalendarMemberGuard } from '../common/guards/calendar-member.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { FeedsService } from './feeds.service'

const createFeedSchema = z.object({
  name: z.string().min(1).max(255),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PRIVATE'),
  isDraft: z.boolean().optional(),
  targetGroupIds: z.array(z.number().int().positive()).optional(),
})

const updateFeedSchema = createFeedSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

@Controller('api/calendars/:calendarId/feeds')
@UseGuards(JwtAuthGuard, CalendarMemberGuard)
export class FeedsController {
  constructor(private readonly service: FeedsService) {}

  @Get()
  list(@Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.service.listFeeds(calendarId)
  }

  @Post()
  @HttpCode(201)
  create(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(createFeedSchema)) dto: any,
  ) {
    return this.service.createFeed(calendarId, dto)
  }

  @Patch(':feedId')
  update(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('feedId', ParseIntPipe) feedId: number,
    @Body(new ZodValidationPipe(updateFeedSchema)) dto: any,
  ) {
    return this.service.updateFeed(feedId, calendarId, dto)
  }

  @Delete(':feedId')
  @HttpCode(200)
  async remove(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('feedId', ParseIntPipe) feedId: number,
  ) {
    await this.service.removeFeed(feedId, calendarId)
    return { ok: true }
  }

  @Post(':feedId/regenerate-secret')
  regenerateSecret(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('feedId', ParseIntPipe) feedId: number,
  ) {
    return this.service.regenerateSecret(feedId, calendarId)
  }
}
