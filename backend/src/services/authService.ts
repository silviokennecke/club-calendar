import { prisma } from '../lib/prisma.js'
import { verifyPassword, hashPassword } from '../lib/password.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js'
import { unauthorized, badRequest } from '../lib/errors.js'

export async function register(name: string, email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw badRequest('Email already in use')
  const hashed = await hashPassword(password)
  const user = await prisma.user.create({ data: { name, email, password: hashed } })
  const accessToken = await signAccessToken(user.id)
  const refreshToken = await signRefreshToken(user.id)
  return { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email } }
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.password) throw unauthorized('Invalid credentials')
  const valid = await verifyPassword(password, user.password)
  if (!valid) throw unauthorized('Invalid credentials')
  const accessToken = await signAccessToken(user.id)
  const refreshToken = await signRefreshToken(user.id)
  return { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email } }
}

export async function refresh(refreshToken: string) {
  const payload = await verifyRefreshToken(refreshToken).catch(() => {
    throw unauthorized('Invalid refresh token')
  })
  const user = await prisma.user.findUnique({ where: { id: payload.sub } })
  if (!user) throw unauthorized('User not found')
  const accessToken = await signAccessToken(user.id)
  return { accessToken }
}

export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      dateFormat: true,
      firstDayOfWeek: true,
      passkeys: { select: { id: true, deviceName: true, createdAt: true } },
      oauthAccounts: { select: { provider: true } },
    },
  })
  if (!user) throw unauthorized('User not found')
  return user
}

export async function updateMe(userId: number, data: { dateFormat?: string; firstDayOfWeek?: number }) {
  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, name: true, email: true, dateFormat: true, firstDayOfWeek: true },
  })
  return user
}

// Find or create a user from an OAuth provider callback
export async function findOrCreateOAuthUser(
  provider: string,
  providerId: string,
  email: string,
  name: string,
) {
  // Check existing OAuth account (use findFirst to handle orphaned records gracefully)
  const existing = await prisma.oAuthAccount.findFirst({
    where: { provider, providerId },
    include: { user: true },
  })
  if (existing) {
    if (!existing.user) {
      // Orphaned account — user was deleted externally; clean up and fall through
      await prisma.oAuthAccount.delete({ where: { id: existing.id } })
    } else {
      const accessToken = await signAccessToken(existing.user.id)
      const refreshToken = await signRefreshToken(existing.user.id)
      return {
        accessToken,
        refreshToken,
        user: { id: existing.user.id, name: existing.user.name, email: existing.user.email },
      }
    }
  }
  // Check existing user by email — link them
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    user = await prisma.user.create({ data: { name, email, password: null } })
  }
  await prisma.oAuthAccount.create({ data: { userId: user.id, provider, providerId, email } })
  const accessToken = await signAccessToken(user.id)
  const refreshToken = await signRefreshToken(user.id)
  return { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email } }
}
