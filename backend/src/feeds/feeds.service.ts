import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { FeedVisibility } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { notFound } from '../lib/errors'

@Injectable()
export class FeedsService {
  constructor(private readonly prisma: PrismaService) {}

  listFeeds(calendarId: number) {
    return this.prisma.calendarFeed.findMany({
      where: { calendarId },
      include: { targetGroups: true },
      orderBy: { name: 'asc' },
    })
  }

  createFeed(calendarId: number, data: {
    name: string
    visibility: 'PUBLIC' | 'PRIVATE'
    isDraft?: boolean
    targetGroupIds?: number[]
  }) {
    const { targetGroupIds = [], ...rest } = data
    return this.prisma.calendarFeed.create({
      data: {
        calendarId,
        ...rest,
        visibility: rest.visibility as FeedVisibility,
        sharedSecret: randomUUID(),
        targetGroups: { create: targetGroupIds.map((targetGroupId) => ({ targetGroupId })) },
      },
      include: { targetGroups: true },
    })
  }

  async updateFeed(id: number, calendarId: number, data: {
    name?: string
    visibility?: 'PUBLIC' | 'PRIVATE'
    isDraft?: boolean
    targetGroupIds?: number[]
  }) {
    const feed = await this.prisma.calendarFeed.findUnique({ where: { id } })
    if (!feed || feed.calendarId !== calendarId) throw notFound('Feed not found')
    const { targetGroupIds, ...rest } = data
    return this.prisma.$transaction(async (tx) => {
      if (targetGroupIds !== undefined) {
        await tx.calendarFeedTargetGroup.deleteMany({ where: { feedId: id } })
        if (targetGroupIds.length > 0) {
          await tx.calendarFeedTargetGroup.createMany({
            data: targetGroupIds.map((targetGroupId) => ({ feedId: id, targetGroupId })),
          })
        }
      }
      return tx.calendarFeed.update({
        where: { id },
        data: rest.visibility ? { ...rest, visibility: rest.visibility as FeedVisibility } : rest,
        include: { targetGroups: true },
      })
    })
  }

  async removeFeed(id: number, calendarId: number) {
    const feed = await this.prisma.calendarFeed.findUnique({ where: { id } })
    if (!feed || feed.calendarId !== calendarId) throw notFound('Feed not found')
    await this.prisma.calendarFeed.delete({ where: { id } })
  }

  async regenerateSecret(id: number, calendarId: number) {
    const feed = await this.prisma.calendarFeed.findUnique({ where: { id } })
    if (!feed || feed.calendarId !== calendarId) throw notFound('Feed not found')
    return this.prisma.calendarFeed.update({
      where: { id },
      data: { sharedSecret: randomUUID() },
      include: { targetGroups: true },
    })
  }
}
