import { PrismaClient, FeedVisibility } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  // Create admin user
  const hashedPassword = await bcrypt.hash('password123', 10)
  const user = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@example.com',
      password: hashedPassword,
    },
  })

  // Create club
  const club = await prisma.club.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: 'Schützenverein Musterstadt',
      timezone: 'Europe/Berlin',
      users: { create: { userId: user.id } },
    },
  })

  // Create calendar
  const calendar = await prisma.calendar.upsert({
    where: { id: 1 },
    update: {},
    create: {
      clubId: club.id,
      name: 'Vereinskalender 2026',
    },
  })

  // Create target groups
  const [jugend, erwachsene] = await Promise.all([
    prisma.targetGroup.upsert({
      where: { id: 1 },
      update: {},
      create: { calendarId: calendar.id, name: 'Jugend' },
    }),
    prisma.targetGroup.upsert({
      where: { id: 2 },
      update: {},
      create: { calendarId: calendar.id, name: 'Erwachsene' },
    }),
  ])

  // Create property
  const tracht = await prisma.property.upsert({
    where: { id: 1 },
    update: {},
    create: { calendarId: calendar.id, name: 'Schützentracht', icon: '🎯' },
  })

  // Create feature
  const bonus = await prisma.feature.upsert({
    where: { id: 1 },
    update: {},
    create: { calendarId: calendar.id, name: 'Bonusschießen' },
  })

  // Create location
  const location = await prisma.location.upsert({
    where: { id: 1 },
    update: {},
    create: { calendarId: calendar.id, address: 'Schützenstraße 1, 12345 Musterstadt' },
  })

  // Create event template
  const template = await prisma.eventTemplate.upsert({
    where: { id: 1 },
    update: {},
    create: {
      calendarId: calendar.id,
      locationId: location.id,
      name: 'Vereinsabend',
      timezone: 'Europe/Berlin',
      timeBegin: '19:00',
      timeEnd: '22:00',
      targetGroups: { create: [{ targetGroupId: erwachsene.id }] },
    },
  })

  // Create calendar feeds
  await prisma.calendarFeed.upsert({
    where: { id: 1 },
    update: {},
    create: {
      calendarId: calendar.id,
      name: 'Öffentlicher Kalender',
      visibility: FeedVisibility.PUBLIC,
      sharedSecret: randomUUID(),
      isDraft: false,
    },
  })

  await prisma.calendarFeed.upsert({
    where: { id: 2 },
    update: {},
    create: {
      calendarId: calendar.id,
      name: 'Jugendkalender (privat)',
      visibility: FeedVisibility.PRIVATE,
      sharedSecret: randomUUID(),
      isDraft: false,
      targetGroups: { create: [{ targetGroupId: jugend.id }] },
    },
  })

  // Create sample events
  await prisma.event.upsert({
    where: { id: 1 },
    update: {},
    create: {
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

  await prisma.event.upsert({
    where: { id: 2 },
    update: {},
    create: {
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
