import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Req,
  Res,
  HttpCode,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { z } from 'zod'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { enabledProviders } from '../env'

const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const updateMeSchema = z.object({
  dateFormat: z.string().min(1).max(20).optional(),
  firstDayOfWeek: z.number().int().min(0).max(6).optional(),
  lastClubId: z.number().int().positive().nullable().optional(),
  lastCalendarId: z.number().int().positive().nullable().optional(),
})

type RegisterDto = z.infer<typeof registerSchema>
type LoginDto = z.infer<typeof loginSchema>
type UpdateMeDto = z.infer<typeof updateMeSchema>

function setRefreshCookie(res: Response, token: string) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/api/auth/refresh',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // maxAge in ms for express
  })
}

function clearRefreshCookie(res: Response) {
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' })
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto.name, dto.email, dto.password)
    setRefreshCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.email, dto.password)
    setRefreshCookie(res, result.refreshToken)
    return { accessToken: result.accessToken, user: result.user }
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.['refreshToken']
    if (!token) throw new UnauthorizedException('No refresh token')
    const result = await this.authService.refresh(token)
    return result
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: Response) {
    clearRefreshCookie(res)
    return { ok: true }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() userId: number) {
    return this.authService.getMe(userId)
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(
    @CurrentUser() userId: number,
    @Body(new ZodValidationPipe(updateMeSchema)) dto: UpdateMeDto,
  ) {
    return this.authService.updateMe(userId, dto)
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async deleteMe(
    @CurrentUser() userId: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.deleteMe(userId)
    clearRefreshCookie(res)
    return { ok: true }
  }

  @Get('providers')
  getProviders() {
    return enabledProviders
  }
}
