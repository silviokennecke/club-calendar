import { randomUUID } from 'crypto'
import { FeedVisibility } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { notFound } from '../lib/errors.js'

export async function listFeeds(calendarId: number) {
  return prisma.calendarFeed.findMany({
    where: { calendarId },
    include: { targetGroups: true },
    orderBy: { name: 'asc' },
  })
}

export async function createFeed(calendarId: number, data: {
  name: string
  visibility: 'PUBLIC' | 'PRIVATE'
  isDraft?: boolean
  targetGroupIds?: number[]
}) {
  const { targetGroupIds = [], ...rest } = data
  return prisma.calendarFeed.create({
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

export async function updateFeed(id: number, calendarId: number, data: {
  name?: string
  visibility?: 'PUBLIC' | 'PRIVATE'
  isDraft?: boolean
  targetGroupIds?: number[]
}) {
  const feed = await prisma.calendarFeed.findUnique({ where: { id } })
  if (!feed || feed.calendarId !== calendarId) throw notFound('Feed not found')
  const { targetGroupIds, ...rest } = data
  return prisma.$transaction(async (tx) => {
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

export async function removeFeed(id: number, calendarId: number) {
  const feed = await prisma.calendarFeed.findUnique({ where: { id } })
  if (!feed || feed.calendarId !== calendarId) throw notFound('Feed not found')
  await prisma.calendarFeed.delete({ where: { id } })
}

export async function regenerateSecret(id: number, calendarId: number) {
  const feed = await prisma.calendarFeed.findUnique({ where: { id } })
  if (!feed || feed.calendarId !== calendarId) throw notFound('Feed not found')
  return prisma.calendarFeed.update({
    where: { id },
    data: { sharedSecret: randomUUID() },
    include: { targetGroups: true },
  })
}
