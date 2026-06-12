import { prisma } from '../lib/prisma.js'
import { hashPassword } from '../lib/password.js'
import { signAccessToken } from '../lib/jwt.js'

export async function createTestUser(overrides?: { email?: string; name?: string }) {
  return prisma.user.create({
    data: {
      email: overrides?.email ?? 'test@example.com',
      name: overrides?.name ?? 'Test User',
      password: await hashPassword('password123'),
    },
  })
}

export async function createTestClub(userId: number, overrides?: { name?: string }) {
  return prisma.club.create({
    data: {
      name: overrides?.name ?? 'Test Club',
      timezone: 'Europe/Berlin',
      users: { create: { userId } },
    },
  })
}

export async function createTestCalendar(clubId: number, overrides?: { name?: string }) {
  return prisma.calendar.create({
    data: {
      clubId,
      name: overrides?.name ?? 'Test Calendar',
    },
  })
}

export async function getAuthHeader(userId: number): Promise<string> {
  const token = await signAccessToken(userId)
  return `Bearer ${token}`
}
