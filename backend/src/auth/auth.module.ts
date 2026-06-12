import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { WebAuthnController } from './webauthn.controller'
import { WebAuthnService } from './webauthn.service'
import { OAuthController } from './oauth.controller'
import { OAuthService } from './oauth.service'

@Module({
  controllers: [AuthController, WebAuthnController, OAuthController],
  providers: [AuthService, WebAuthnService, OAuthService],
  exports: [AuthService],
})
export class AuthModule {}
