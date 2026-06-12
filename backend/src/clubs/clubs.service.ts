import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { notFound } from '../lib/errors'

@Injectable()
export class ClubsService {
  constructor(private readonly prisma: PrismaService) {}

  async listClubs(userId: number) {
    return this.prisma.club.findMany({
      where: { users: { some: { userId } } },
      include: { _count: { select: { calendars: true } } },
      orderBy: { name: 'asc' },
    })
  }

  async createClub(userId: number, data: { name: string; timezone: string }) {
    return this.prisma.club.create({
      data: {
        ...data,
        users: { create: { userId } },
      },
    })
  }

  async getClub(clubId: number) {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } })
    if (!club) throw notFound('Club not found')
    return club
  }

  async updateClub(clubId: number, data: { name?: string; timezone?: string }) {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } })
    if (!club) throw notFound('Club not found')
    return this.prisma.club.update({ where: { id: clubId }, data })
  }

  async deleteClub(clubId: number) {
    await this.prisma.club.delete({ where: { id: clubId } })
  }

  async listMembers(clubId: number) {
    const members = await this.prisma.clubUser.findMany({
      where: { clubId },
      include: { user: { select: { id: true, name: true, email: true } } },
    })
    return members.map((m) => m.user)
  }

  async addMember(clubId: number, email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw notFound('User not found')
    const existing = await this.prisma.clubUser.findUnique({
      where: { clubId_userId: { clubId, userId: user.id } },
    })
    if (existing) return user
    await this.prisma.clubUser.create({ data: { clubId, userId: user.id } })
    return user
  }

  async removeMember(clubId: number, userId: number) {
    await this.prisma.clubUser.deleteMany({ where: { clubId, userId } })
  }
}
