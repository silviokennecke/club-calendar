import { Injectable } from '@nestjs/common'
import { FeedVisibility } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { notFound, forbidden } from '../lib/errors'
import { buildIcs } from '../lib/ics'

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeedIcs(feedId: number, secret?: string, targetGroupIds?: number[]): Promise<string> {
    const feed = await this.prisma.calendarFeed.findUnique({
      where: { id: feedId },
      include: {
        calendar: {
          include: {
            club: true,
          },
        },
        targetGroups: true,
      },
    })

    if (!feed) throw notFound('Feed not found')

    if (feed.visibility === FeedVisibility.PRIVATE) {
      if (!secret || secret !== feed.sharedSecret) throw forbidden('Invalid secret')
    }

    const filterGroupIds = (targetGroupIds && targetGroupIds.length > 0)
      ? targetGroupIds
      : feed.targetGroups.map((ftg) => ftg.targetGroupId)

    const events = await this.prisma.event.findMany({
      where: {
        calendarId: feed.calendarId,
        isDraft: false,
        ...(filterGroupIds.length > 0
          ? { targetGroups: { some: { targetGroupId: { in: filterGroupIds } } } }
          : {}),
      },
      include: {
        location: true,
        properties: { include: { property: true } },
        features: { include: { feature: true } },
        targetGroups: { include: { targetGroup: true } },
      },
      orderBy: { date: 'asc' },
    })

    return buildIcs(feed.name, feed.calendar.club.timezone, events)
  }

  async getFeedEvents(feedId: number, secret?: string, targetGroupIds?: number[]) {
    const feed = await this.prisma.calendarFeed.findUnique({
      where: { id: feedId },
      include: {
        calendar: { include: { club: true } },
        targetGroups: true,
      },
    })

    if (!feed) throw notFound('Feed not found')

    if (feed.visibility === FeedVisibility.PRIVATE) {
      if (!secret || secret !== feed.sharedSecret) throw forbidden('Invalid secret')
    }

    const filterGroupIds = (targetGroupIds && targetGroupIds.length > 0)
      ? targetGroupIds
      : feed.targetGroups.map((ftg) => ftg.targetGroupId)

    const events = await this.prisma.event.findMany({
      where: {
        calendarId: feed.calendarId,
        isDraft: false,
        ...(filterGroupIds.length > 0
          ? { targetGroups: { some: { targetGroupId: { in: filterGroupIds } } } }
          : {}),
      },
      include: {
        location: true,
        properties: { include: { property: true } },
        features: { include: { feature: true } },
        targetGroups: { include: { targetGroup: true } },
      },
      orderBy: { date: 'asc' },
    })

    return { feed, events }
  }
}
