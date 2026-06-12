import { prisma } from '../lib/prisma.js'
import { notFound, forbidden } from '../lib/errors.js'
import { buildIcs } from '../lib/ics.js'
import { FeedVisibility } from '@prisma/client'

export async function getFeedIcs(feedId: number, secret?: string): Promise<string> {
  const feed = await prisma.calendarFeed.findUnique({
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

  if (!feed || feed.isDraft) throw notFound('Feed not found')

  if (feed.visibility === FeedVisibility.PRIVATE) {
    if (!secret || secret !== feed.sharedSecret) throw forbidden('Invalid secret')
  }

  const targetGroupIds = feed.targetGroups.map((ftg) => ftg.targetGroupId)

  const events = await prisma.event.findMany({
    where: {
      calendarId: feed.calendarId,
      isDraft: false,
      ...(targetGroupIds.length > 0
        ? { targetGroups: { some: { targetGroupId: { in: targetGroupIds } } } }
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
