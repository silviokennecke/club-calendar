import { PrismaClient, FeedVisibility } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  // Delete all data in FK-safe order for idempotent re-runs
  await prisma.eventTargetGroup.deleteMany()
  await prisma.eventFeature.deleteMany()
  await prisma.eventProperty.deleteMany()
  await prisma.eventTemplateTargetGroup.deleteMany()
  await prisma.eventTemplateFeature.deleteMany()
  await prisma.eventTemplateProperty.deleteMany()
  await prisma.calendarFeedTargetGroup.deleteMany()
  await prisma.event.deleteMany()
  await prisma.eventTemplate.deleteMany()
  await prisma.calendarFeed.deleteMany()
  await prisma.location.deleteMany()
  await prisma.targetGroup.deleteMany()
  await prisma.feature.deleteMany()
  await prisma.property.deleteMany()
  await prisma.calendar.deleteMany()
  await prisma.clubUser.deleteMany()
  await prisma.club.deleteMany()
  await prisma.user.deleteMany()

  const hashedPassword = await bcrypt.hash('password123', 10)
  const user = await prisma.user.create({
    data: {
      name: 'Admin User',
      email: 'admin@example.com',
      password: hashedPassword,
    },
  })

  const club = await prisma.club.create({
    data: {
      name: 'Schützenverein Musterstadt',
      timezone: 'Europe/Berlin',
      users: { create: { userId: user.id } },
    },
  })

  const calendar = await prisma.calendar.create({
    data: { clubId: club.id, name: 'Vereinskalender 2026' },
  })

  const [jugend, erwachsene] = await Promise.all([
    prisma.targetGroup.create({ data: { calendarId: calendar.id, name: 'Jugend' } }),
    prisma.targetGroup.create({ data: { calendarId: calendar.id, name: 'Erwachsene' } }),
  ])

  const tracht = await prisma.property.create({
    data: { calendarId: calendar.id, name: 'Schützentracht', icon: '🎯' },
  })

  const bonus = await prisma.feature.create({
    data: { calendarId: calendar.id, name: 'Bonusschießen' },
  })

  const location = await prisma.location.create({
    data: { calendarId: calendar.id, address: 'Schützenstraße 1, 12345 Musterstadt' },
  })

  const template = await prisma.eventTemplate.create({
    data: {
      calendarId: calendar.id,
      locationId: location.id,
      name: 'Vereinsabend',
      timezone: 'Europe/Berlin',
      timeBegin: '19:00',
      timeEnd: '22:00',
      targetGroups: { create: [{ targetGroupId: erwachsene.id }] },
    },
  })

  await prisma.calendarFeed.create({
    data: {
      calendarId: calendar.id,
      name: 'Öffentlicher Kalender',
      visibility: FeedVisibility.PUBLIC,
      sharedSecret: randomUUID(),
      isDraft: false,
    },
  })

  await prisma.calendarFeed.create({
    data: {
      calendarId: calendar.id,
      name: 'Jugendkalender (privat)',
      visibility: FeedVisibility.PRIVATE,
      sharedSecret: randomUUID(),
      isDraft: false,
      targetGroups: { create: [{ targetGroupId: jugend.id }] },
    },
  })

  await prisma.event.create({
    data: {
      calendarId: calendar.id,
      eventTemplateId: template.id,
      locationId: location.id,
      name: 'Vereinsabend Juni',
      timezone: 'Europe/Berlin',
      date: new Date('2026-06-15'),
      timeBegin: '19:00',
      timeEnd: '22:00',
      isDraft: false,
      targetGroups: { create: [{ targetGroupId: erwachsene.id }] },
      properties: { create: [{ propertyId: tracht.id }] },
      features: { create: [{ featureId: bonus.id }] },
    },
  })

  await prisma.event.create({
    data: {
      calendarId: calendar.id,
      name: 'Jugendtraining',
      timezone: 'Europe/Berlin',
      date: new Date('2026-06-20'),
      timeBegin: '15:00',
      timeEnd: '17:00',
      isDraft: false,
      targetGroups: { create: [{ targetGroupId: jugend.id }] },
    },
  })

  console.log('Seed complete!')
  console.log('Login: admin@example.com / password123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
