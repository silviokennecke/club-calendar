import { sign, verify } from 'hono/jwt'
import { env } from '../env.js'

interface AccessPayload {
  sub: number
  type: 'access'
  exp: number
  iat: number
}

interface RefreshPayload {
  sub: number
  type: 'refresh'
  exp: number
  iat: number
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

export async function signAccessToken(userId: number): Promise<string> {
  const now = nowSeconds()
  return sign(
    { sub: userId, type: 'access', iat: now, exp: now + 15 * 60 },
    env.JWT_ACCESS_SECRET,
  )
}

export async function signRefreshToken(userId: number): Promise<string> {
  const now = nowSeconds()
  return sign(
    { sub: userId, type: 'refresh', iat: now, exp: now + 7 * 24 * 60 * 60 },
    env.JWT_REFRESH_SECRET,
  )
}

export async function verifyAccessToken(token: string): Promise<AccessPayload> {
  const payload = await verify(token, env.JWT_ACCESS_SECRET)
  if (payload.type !== 'access') throw new Error('Invalid token type')
  return payload as unknown as AccessPayload
}

export async function verifyRefreshToken(token: string): Promise<RefreshPayload> {
  const payload = await verify(token, env.JWT_REFRESH_SECRET)
  if (payload.type !== 'refresh') throw new Error('Invalid token type')
  return payload as unknown as RefreshPayload
}
