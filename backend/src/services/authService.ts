import { prisma } from '../lib/prisma.js'
import { verifyPassword } from '../lib/password.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js'
import { unauthorized } from '../lib/errors.js'

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw unauthorized('Invalid credentials')
  const valid = await verifyPassword(password, user.password)
  if (!valid) throw unauthorized('Invalid credentials')
  const accessToken = await signAccessToken(user.id)
  const refreshToken = await signRefreshToken(user.id)
  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email },
  }
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
    select: { id: true, name: true, email: true },
  })
  if (!user) throw unauthorized('User not found')
  return user
}
