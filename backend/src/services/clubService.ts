import { prisma } from '../lib/prisma.js'
import { notFound, forbidden } from '../lib/errors.js'

export async function listClubs(userId: number) {
  return prisma.club.findMany({
    where: { users: { some: { userId } } },
    include: { _count: { select: { calendars: true } } },
    orderBy: { name: 'asc' },
  })
}

export async function createClub(userId: number, data: { name: string; timezone: string }) {
  return prisma.club.create({
    data: {
      ...data,
      users: { create: { userId } },
    },
  })
}

export async function getClub(clubId: number) {
  const club = await prisma.club.findUnique({ where: { id: clubId } })
  if (!club) throw notFound('Club not found')
  return club
}

export async function updateClub(clubId: number, data: { name?: string; timezone?: string }) {
  const club = await prisma.club.findUnique({ where: { id: clubId } })
  if (!club) throw notFound('Club not found')
  return prisma.club.update({ where: { id: clubId }, data })
}

export async function deleteClub(clubId: number) {
  await prisma.club.delete({ where: { id: clubId } })
}

export async function listMembers(clubId: number) {
  const members = await prisma.clubUser.findMany({
    where: { clubId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  return members.map((m) => m.user)
}

export async function addMember(clubId: number, email: string) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw notFound('User not found')
  const existing = await prisma.clubUser.findUnique({
    where: { clubId_userId: { clubId, userId: user.id } },
  })
  if (existing) return user
  await prisma.clubUser.create({ data: { clubId, userId: user.id } })
  return user
}

export async function removeMember(clubId: number, userId: number) {
  await prisma.clubUser.deleteMany({ where: { clubId, userId } })
}
