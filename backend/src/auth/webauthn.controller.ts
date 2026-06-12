import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Res,
  HttpCode,
  UseGuards,
} from '@nestjs/common'
import { Response } from 'express'
import { WebAuthnService } from './webauthn.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'

@Controller('api/auth/webauthn')
export class WebAuthnController {
  constructor(private readonly webAuthnService: WebAuthnService) {}

  @Get('register/options')
  @UseGuards(JwtAuthGuard)
  async getRegistrationOptions(@CurrentUser() userId: number) {
    return this.webAuthnService.getRegistrationOptions(userId)
  }

  @Post('register/verify')
  @UseGuards(JwtAuthGuard)
  async verifyRegistration(
    @CurrentUser() userId: number,
    @Body() body: { challengeToken: string; response: unknown; deviceName?: string },
  ) {
    return this.webAuthnService.verifyRegistration(
      userId,
      body.challengeToken,
      body.response as never,
      body.deviceName,
    )
  }

  @Get('authenticate/options')
  async getAuthenticationOptions() {
    return this.webAuthnService.getAuthenticationOptions()
  }

  @Post('authenticate/verify')
  async verifyAuthentication(
    @Body() body: { challengeToken: string; response: unknown },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.webAuthnService.verifyAuthentication(
      body.challengeToken,
      body.response as never,
    )
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/auth/refresh',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    return { accessToken: result.accessToken, user: result.user }
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async deletePasskey(@Param('id') id: string, @CurrentUser() userId: number) {
    await this.webAuthnService.deletePasskey(id, userId)
    return { ok: true }
  }
}
