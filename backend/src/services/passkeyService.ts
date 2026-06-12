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
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { sign, verify } from 'hono/jwt'
import { prisma } from '../lib/prisma.js'
import { env } from '../env.js'
import { unauthorized, badRequest, notFound } from '../lib/errors.js'
import { signAccessToken, signRefreshToken } from '../lib/jwt.js'

const CHALLENGE_SECRET = env.JWT_ACCESS_SECRET + '-webauthn-challenge'

// Sign a short-lived challenge token
async function signChallenge(challenge: string, userId?: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return sign({ challenge, userId, iat: now, exp: now + 300 }, CHALLENGE_SECRET, 'HS256')
}

async function verifyChallenge(
  token: string,
): Promise<{ challenge: string; userId?: number }> {
  try {
    const payload = (await verify(token, CHALLENGE_SECRET, 'HS256')) as {
      challenge: string
      userId?: number
    }
    return payload
  } catch {
    throw unauthorized('Invalid or expired challenge')
  }
}

export async function getRegistrationOptions(userId: number) {
  const user = await prisma.user.findUnique({
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

  const challengeToken = await signChallenge(options.challenge, userId)
  return { options, challengeToken }
}

export async function verifyRegistration(
  userId: number,
  challengeToken: string,
  response: RegistrationResponseJSON,
  deviceName?: string,
) {
  const { challenge } = await verifyChallenge(challengeToken)

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

  await prisma.passkey.create({
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

export async function getAuthenticationOptions() {
  const options = await generateAuthenticationOptions({
    rpID: env.WEBAUTHN_RP_ID,
    userVerification: 'preferred',
    allowCredentials: [],
  })
  const challengeToken = await signChallenge(options.challenge)
  return { options, challengeToken }
}

export async function verifyAuthentication(
  challengeToken: string,
  response: AuthenticationResponseJSON,
) {
  const { challenge } = await verifyChallenge(challengeToken)

  const passkey = await prisma.passkey.findUnique({
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
  await prisma.passkey.update({
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

export async function deletePasskey(id: string, userId: number) {
  const pk = await prisma.passkey.findUnique({ where: { id } })
  if (!pk || pk.userId !== userId) throw notFound('Passkey not found')
  await prisma.passkey.delete({ where: { id } })
}
