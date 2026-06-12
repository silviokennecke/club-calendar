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

export async function createTestCalendarWithClub() {
  const user = await createTestUser()
  const club = await createTestClub(user.id)
  const calendar = await createTestCalendar(club.id)
  return { user, club, calendar }
}

export async function createTestEvent(calendarId: number, overrides?: { name?: string; date?: string; isDraft?: boolean }) {
  return prisma.event.create({
    data: {
      calendarId,
      name: overrides?.name ?? 'Test Event',
      date: new Date(overrides?.date ?? '2026-06-15'),
      timeBegin: '19:00',
      timeEnd: '21:00',
      isDraft: overrides?.isDraft ?? false,
      timezone: 'Europe/Berlin',
    },
  })
}

export async function createTestTemplate(calendarId: number, overrides?: { name?: string }) {
  return prisma.eventTemplate.create({
    data: {
      calendarId,
      name: overrides?.name ?? 'Test Template',
      timezone: 'Europe/Berlin',
      timeBegin: '19:00',
      timeEnd: '21:00',
    },
  })
}
