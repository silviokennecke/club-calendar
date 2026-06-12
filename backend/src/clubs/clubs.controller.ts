import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, HttpCode, ParseIntPipe } from '@nestjs/common'
import { z } from 'zod'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ClubMemberGuard } from '../common/guards/club-member.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { ClubsService } from './clubs.service'

const createClubSchema = z.object({
  name: z.string().min(1).max(255),
  timezone: z.string().min(1).default('Europe/Berlin'),
})

const updateClubSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  timezone: z.string().min(1).optional(),
})

const addMemberSchema = z.object({
  email: z.string().email(),
})

@Controller('api/clubs')
@UseGuards(JwtAuthGuard)
export class ClubsController {
  constructor(private readonly clubs: ClubsService) {}

  @Get()
  list(@CurrentUser() userId: number) {
    return this.clubs.listClubs(userId)
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() userId: number, @Body(new ZodValidationPipe(createClubSchema)) dto: any) {
    return this.clubs.createClub(userId, dto)
  }

  @Get(':clubId')
  @UseGuards(ClubMemberGuard)
  getOne(@Param('clubId', ParseIntPipe) clubId: number) {
    return this.clubs.getClub(clubId)
  }

  @Patch(':clubId')
  @UseGuards(ClubMemberGuard)
  update(@Param('clubId', ParseIntPipe) clubId: number, @Body(new ZodValidationPipe(updateClubSchema)) dto: any) {
    return this.clubs.updateClub(clubId, dto)
  }

  @Delete(':clubId')
  @UseGuards(ClubMemberGuard)
  @HttpCode(200)
  async remove(@Param('clubId', ParseIntPipe) clubId: number) {
    await this.clubs.deleteClub(clubId)
    return { ok: true }
  }

  @Get(':clubId/members')
  @UseGuards(ClubMemberGuard)
  listMembers(@Param('clubId', ParseIntPipe) clubId: number) {
    return this.clubs.listMembers(clubId)
  }

  @Post(':clubId/members')
  @UseGuards(ClubMemberGuard)
  @HttpCode(201)
  addMember(@Param('clubId', ParseIntPipe) clubId: number, @Body(new ZodValidationPipe(addMemberSchema)) dto: any) {
    return this.clubs.addMember(clubId, dto.email)
  }

  @Delete(':clubId/members/:userId')
  @UseGuards(ClubMemberGuard)
  @HttpCode(200)
  async removeMember(@Param('clubId', ParseIntPipe) clubId: number, @Param('userId', ParseIntPipe) memberId: number) {
    await this.clubs.removeMember(clubId, memberId)
    return { ok: true }
  }
}
