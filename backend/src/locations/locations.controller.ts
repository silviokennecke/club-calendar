import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, ParseIntPipe } from '@nestjs/common'
import { z } from 'zod'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CalendarMemberGuard } from '../common/guards/calendar-member.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { LocationsService } from './locations.service'

const locationSchema = z.object({
  name: z.string().max(255).nullable().optional(),
  address: z.string().min(1).max(500),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
})

const patchSchema = locationSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field required' },
)

@Controller('api/calendars/:calendarId/locations')
@UseGuards(JwtAuthGuard, CalendarMemberGuard)
export class LocationsController {
  constructor(private readonly service: LocationsService) {}

  @Get()
  list(@Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.service.listLocations(calendarId)
  }

  @Post()
  @HttpCode(201)
  create(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(locationSchema)) dto: any,
  ) {
    return this.service.createLocation(calendarId, dto)
  }

  @Patch(':id')
  update(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(patchSchema)) dto: any,
  ) {
    return this.service.updateLocation(id, calendarId, dto)
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.service.removeLocation(id, calendarId)
    return { ok: true }
  }
}
