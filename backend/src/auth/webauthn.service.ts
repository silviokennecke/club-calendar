import { Injectable } from '@nestjs/common'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server'
import * as jwt from 'jsonwebtoken'
import { PrismaService } from '../prisma/prisma.service'
import { env } from '../env'
import { unauthorized, badRequest, notFound } from '../lib/errors'
import { signAccessToken, signRefreshToken } from '../lib/jwt'

const CHALLENGE_SECRET = env.JWT_ACCESS_SECRET + '-webauthn-challenge'

@Injectable()
export class WebAuthnService {
  constructor(private readonly prisma: PrismaService) {}

  private signChallenge(challenge: string, userId?: number): string {
    return jwt.sign({ challenge, userId }, CHALLENGE_SECRET, {
      algorithm: 'HS256',
      expiresIn: 300,
    })
  }

  private verifyChallenge(token: string): { challenge: string; userId?: number } {
    try {
      return jwt.verify(token, CHALLENGE_SECRET) as { challenge: string; userId?: number }
    } catch {
      throw unauthorized('Invalid or expired challenge')
    }
  }

  async getRegistrationOptions(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { passkeys: true },
    })
    if (!user) throw notFound('User not found')

    const options = await generateRegistrationOptions({
      rpName: env.WEBAUTHN_RP_NAME,
      rpID: env.WEBAUTHN_RP_ID,
      userID: new TextEncoder().encode(String(userId)),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: 'none',
      excludeCredentials: user.passkeys.map((pk) => ({
        id: pk.credentialId,
        type: 'public-key' as const,
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    })

    const challengeToken = this.signChallenge(options.challenge, userId)
    return { options, challengeToken }
  }

  async verifyRegistration(
    userId: number,
    challengeToken: string,
    response: RegistrationResponseJSON,
    deviceName?: string,
  ) {
    const { challenge } = this.verifyChallenge(challengeToken)

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: env.FRONTEND_URL,
      expectedRPID: env.WEBAUTHN_RP_ID,
      requireUserVerification: false,
    })

    if (!verification.verified || !verification.registrationInfo) {
      throw badRequest('Passkey registration failed')
    }

    const { credential } = verification.registrationInfo

    await this.prisma.passkey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        deviceName: deviceName ?? 'Unknown device',
      },
    })

    return { verified: true }
  }

  async getAuthenticationOptions() {
    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      userVerification: 'preferred',
      allowCredentials: [],
    })
    const challengeToken = this.signChallenge(options.challenge)
    return { options, challengeToken }
  }

  async verifyAuthentication(
    challengeToken: string,
    response: AuthenticationResponseJSON,
  ) {
    const { challenge } = this.verifyChallenge(challengeToken)

    const passkey = await this.prisma.passkey.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    })
    if (!passkey) throw unauthorized('Passkey not found')

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: env.FRONTEND_URL,
      expectedRPID: env.WEBAUTHN_RP_ID,
      requireUserVerification: false,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
      },
    })

    if (!verification.verified) throw unauthorized('Passkey authentication failed')

    // Update counter
    await this.prisma.passkey.update({
      where: { id: passkey.id },
      data: { counter: BigInt(verification.authenticationInfo.newCounter) },
    })

    const accessToken = await signAccessToken(passkey.user.id)
    const refreshToken = await signRefreshToken(passkey.user.id)
    return {
      accessToken,
      refreshToken,
      user: { id: passkey.user.id, name: passkey.user.name, email: passkey.user.email },
    }
  }

  async deletePasskey(id: string, userId: number) {
    const pk = await this.prisma.passkey.findUnique({ where: { id } })
    if (!pk || pk.userId !== userId) throw notFound('Passkey not found')
    await this.prisma.passkey.delete({ where: { id } })
  }
}
