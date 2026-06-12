import { beforeEach, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

beforeEach(async () => {
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0')
  const tables = [
    'EventTargetGroup', 'EventFeature', 'EventProperty',
    'EventTemplateTargetGroup', 'EventTemplateFeature', 'EventTemplateProperty',
    'CalendarFeedTargetGroup',
    'Event', 'EventTemplate', 'CalendarFeed',
    'Location', 'TargetGroup', 'Feature', 'Property',
    'Calendar', 'ClubUser', 'Club', 'User',
  ]
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``)
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1')
})

afterAll(async () => {
  await prisma.$disconnect()
})
