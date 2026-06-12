# Calendar Archive & Duplicate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add archive (soft-hide, read-only) and duplicate (deep-copy minus events) to calendars.

**Architecture:** `archivedAt DateTime?` column on `Calendar`; two action endpoints (`/archive`, `/unarchive`) and one copy endpoint (`/duplicate`) added to `CalendarsController`; a new `ArchivedCalendarGuard` blocks writes on all nested calendar routes; the public feed service checks `calendar.archivedAt`. Frontend club page gets archive/unarchive/duplicate actions and an archived section; the calendar view shows a read-only banner when archived.

**Tech Stack:** NestJS, Prisma 6 + MySQL 8, Next.js 15, Vitest + supertest, TypeScript.

---

## File Map

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Add `archivedAt DateTime?` to `Calendar` |
| `backend/prisma/migrations/20260613000000_calendar_archived_at/migration.sql` | New — ALTER TABLE |
| `backend/src/calendars/calendars.service.ts` | Add `archiveCalendar`, `unarchiveCalendar`, `duplicateCalendar`; update `listCalendars` |
| `backend/src/calendars/calendars.controller.ts` | Add `/archive`, `/unarchive`, `/duplicate` endpoints; add `?includeArchived` query param |
| `backend/src/common/guards/archived-calendar.guard.ts` | New — blocks writes on archived calendars |
| `backend/src/events/events.controller.ts` | Add `ArchivedCalendarGuard` |
| `backend/src/event-templates/event-templates.controller.ts` | Add `ArchivedCalendarGuard` |
| `backend/src/feeds/feeds.controller.ts` | Add `ArchivedCalendarGuard` |
| `backend/src/properties/properties.controller.ts` | Add `ArchivedCalendarGuard` |
| `backend/src/features/features.controller.ts` | Add `ArchivedCalendarGuard` |
| `backend/src/target-groups/target-groups.controller.ts` | Add `ArchivedCalendarGuard` |
| `backend/src/locations/locations.controller.ts` | Add `ArchivedCalendarGuard` |
| `backend/src/public/public.service.ts` | Check `calendar.archivedAt` before serving feed |
| `backend/src/routes/calendars.test.ts` | Add tests for archive/unarchive/duplicate/includeArchived |
| `backend/src/routes/resources.test.ts` | Add tests for 403 on archived calendar writes and public feed block |
| `frontend/src/lib/types.ts` | Add `archivedAt?: string \| null` to `Calendar` |
| `frontend/src/app/(auth)/clubs/[clubId]/page.tsx` | Add archive/unarchive/duplicate actions; archived section |
| `frontend/src/app/(auth)/clubs/[clubId]/calendars/[calendarId]/page.tsx` | Add read-only banner when `archivedAt` is set |

---

## Task 1: DB Migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260613000000_calendar_archived_at/migration.sql`

- [ ] **Add `archivedAt` to the Calendar model in `backend/prisma/schema.prisma`:**

```prisma
model Calendar {
  id           Int             @id @default(autoincrement())
  clubId       Int
  name         String          @db.VarChar(255)
  timezone     String?         @db.VarChar(100)
  archivedAt   DateTime?
  club         Club            @relation(fields: [clubId], references: [id], onDelete: Cascade)
  feeds        CalendarFeed[]
  properties   Property[]
  features     Feature[]
  targetGroups TargetGroup[]
  locations    Location[]
  templates    EventTemplate[]
  events       Event[]
}
```

- [ ] **Create the migration file:**

`backend/prisma/migrations/20260613000000_calendar_archived_at/migration.sql`:
```sql
ALTER TABLE `Calendar` ADD COLUMN `archivedAt` DATETIME NULL;
```

- [ ] **Apply to dev and test databases:**

```bash
cd backend
npx prisma migrate deploy
DATABASE_URL=$(grep TEST_DATABASE_URL .env | cut -d= -f2-) npx prisma migrate deploy
npx prisma generate
```

Expected output: "All migrations have been successfully applied."

- [ ] **Commit:**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "chore: add archivedAt to Calendar model"
```

---

## Task 2: CalendarsService — archive, unarchive, listCalendars

**Files:**
- Modify: `backend/src/calendars/calendars.service.ts`

- [ ] **Replace the full contents of `backend/src/calendars/calendars.service.ts`:**

```typescript
import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { notFound, forbidden } from '../lib/errors'

@Injectable()
export class CalendarsService {
  constructor(private readonly prisma: PrismaService) {}

  async listCalendars(clubId: number, includeArchived = false) {
    return this.prisma.calendar.findMany({
      where: {
        clubId,
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [
        { archivedAt: { sort: 'asc', nulls: 'first' } },
        { name: 'asc' },
      ],
    })
  }

  async createCalendar(clubId: number, data: { name: string; timezone?: string | null }) {
    return this.prisma.calendar.create({ data: { clubId, ...data } })
  }

  async getCalendar(calendarId: number) {
    const cal = await this.prisma.calendar.findUnique({ where: { id: calendarId } })
    if (!cal) throw notFound('Calendar not found')
    return cal
  }

  async updateCalendar(calendarId: number, data: { name?: string; timezone?: string | null }) {
    const cal = await this.prisma.calendar.findUnique({ where: { id: calendarId } })
    if (!cal) throw notFound('Calendar not found')
    return this.prisma.calendar.update({ where: { id: calendarId }, data })
  }

  async deleteCalendar(calendarId: number) {
    await this.prisma.calendar.delete({ where: { id: calendarId } })
  }

  async verifyCalendarBelongsToClub(calendarId: number, clubId: number) {
    const cal = await this.prisma.calendar.findUnique({ where: { id: calendarId } })
    if (!cal || cal.clubId !== clubId) throw forbidden('Calendar not found in this club')
    return cal
  }

  async archiveCalendar(calendarId: number, clubId: number) {
    await this.verifyCalendarBelongsToClub(calendarId, clubId)
    return this.prisma.calendar.update({
      where: { id: calendarId },
      data: { archivedAt: new Date() },
    })
  }

  async unarchiveCalendar(calendarId: number, clubId: number) {
    await this.verifyCalendarBelongsToClub(calendarId, clubId)
    return this.prisma.calendar.update({
      where: { id: calendarId },
      data: { archivedAt: null },
    })
  }

  async duplicateCalendar(calendarId: number, clubId: number) {
    const source = await this.prisma.calendar.findUnique({
      where: { id: calendarId },
      include: {
        properties: true,
        features: true,
        targetGroups: true,
        locations: true,
        templates: {
          include: {
            properties: true,
            features: true,
            targetGroups: true,
          },
        },
        feeds: { include: { targetGroups: true } },
      },
    })
    if (!source || source.clubId !== clubId) throw forbidden('Calendar not found in this club')

    return this.prisma.$transaction(async (tx) => {
      const newCal = await tx.calendar.create({
        data: { clubId, name: `Copy of ${source.name}`, timezone: source.timezone, archivedAt: null },
      })

      const propMap = new Map<number, number>()
      for (const p of source.properties) {
        const n = await tx.property.create({ data: { calendarId: newCal.id, name: p.name, icon: p.icon } })
        propMap.set(p.id, n.id)
      }

      const featureMap = new Map<number, number>()
      for (const f of source.features) {
        const n = await tx.feature.create({ data: { calendarId: newCal.id, name: f.name } })
        featureMap.set(f.id, n.id)
      }

      const tgMap = new Map<number, number>()
      for (const tg of source.targetGroups) {
        const n = await tx.targetGroup.create({ data: { calendarId: newCal.id, name: tg.name } })
        tgMap.set(tg.id, n.id)
      }

      const locMap = new Map<number, number>()
      for (const loc of source.locations) {
        const n = await tx.location.create({
          data: {
            calendarId: newCal.id,
            name: loc.name,
            street: loc.street,
            zip: loc.zip,
            city: loc.city,
            country: loc.country,
            latitude: loc.latitude,
            longitude: loc.longitude,
          },
        })
        locMap.set(loc.id, n.id)
      }

      for (const tmpl of source.templates) {
        await tx.eventTemplate.create({
          data: {
            calendarId: newCal.id,
            name: tmpl.name,
            timezone: tmpl.timezone,
            timeBegin: tmpl.timeBegin,
            timeEnd: tmpl.timeEnd,
            locationId: tmpl.locationId != null ? (locMap.get(tmpl.locationId) ?? null) : null,
            properties: { create: tmpl.properties.map((p) => ({ propertyId: propMap.get(p.propertyId)! })) },
            features: { create: tmpl.features.map((f) => ({ featureId: featureMap.get(f.featureId)! })) },
            targetGroups: { create: tmpl.targetGroups.map((tg) => ({ targetGroupId: tgMap.get(tg.targetGroupId)! })) },
          },
        })
      }

      for (const feed of source.feeds) {
        await tx.calendarFeed.create({
          data: {
            calendarId: newCal.id,
            name: feed.name,
            visibility: feed.visibility,
            sharedSecret: randomUUID(),
            targetGroups: {
              create: feed.targetGroups.map((ftg) => ({ targetGroupId: tgMap.get(ftg.targetGroupId)! })),
            },
          },
        })
      }

      return newCal
    })
  }
}
```

- [ ] **Commit:**

```bash
git add backend/src/calendars/calendars.service.ts
git commit -m "feat: add archive, unarchive, duplicate to CalendarsService"
```

---

## Task 3: CalendarsController — new endpoints + includeArchived

**Files:**
- Modify: `backend/src/calendars/calendars.controller.ts`

- [ ] **Replace the full contents of `backend/src/calendars/calendars.controller.ts`:**

```typescript
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, HttpCode, ParseIntPipe } from '@nestjs/common'
import { z } from 'zod'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ClubMemberGuard } from '../common/guards/club-member.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { CalendarsService } from './calendars.service'

const calendarSchema = z.object({
  name: z.string().min(1).max(255),
  timezone: z.string().max(100).nullable().optional(),
})

const calendarPatchSchema = calendarSchema.partial()

@Controller('api/clubs/:clubId/calendars')
@UseGuards(JwtAuthGuard, ClubMemberGuard)
export class CalendarsController {
  constructor(private readonly calendars: CalendarsService) {}

  @Get()
  list(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.calendars.listCalendars(clubId, includeArchived === 'true')
  }

  @Post()
  @HttpCode(201)
  create(@Param('clubId', ParseIntPipe) clubId: number, @Body(new ZodValidationPipe(calendarSchema)) dto: any) {
    return this.calendars.createCalendar(clubId, dto)
  }

  @Get(':calendarId')
  async getOne(@Param('clubId', ParseIntPipe) clubId: number, @Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.calendars.verifyCalendarBelongsToClub(calendarId, clubId)
  }

  @Patch(':calendarId')
  async update(
    @Param('clubId', ParseIntPipe) clubId: number,
    @Param('calendarId', ParseIntPipe) calendarId: number,
    @Body(new ZodValidationPipe(calendarPatchSchema)) dto: any,
  ) {
    await this.calendars.verifyCalendarBelongsToClub(calendarId, clubId)
    return this.calendars.updateCalendar(calendarId, dto)
  }

  @Delete(':calendarId')
  @HttpCode(200)
  async remove(@Param('clubId', ParseIntPipe) clubId: number, @Param('calendarId', ParseIntPipe) calendarId: number) {
    await this.calendars.verifyCalendarBelongsToClub(calendarId, clubId)
    await this.calendars.deleteCalendar(calendarId)
    return { ok: true }
  }

  @Post(':calendarId/archive')
  @HttpCode(200)
  async archive(@Param('clubId', ParseIntPipe) clubId: number, @Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.calendars.archiveCalendar(calendarId, clubId)
  }

  @Post(':calendarId/unarchive')
  @HttpCode(200)
  async unarchive(@Param('clubId', ParseIntPipe) clubId: number, @Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.calendars.unarchiveCalendar(calendarId, clubId)
  }

  @Post(':calendarId/duplicate')
  @HttpCode(201)
  async duplicate(@Param('clubId', ParseIntPipe) clubId: number, @Param('calendarId', ParseIntPipe) calendarId: number) {
    return this.calendars.duplicateCalendar(calendarId, clubId)
  }
}
```

- [ ] **Commit:**

```bash
git add backend/src/calendars/calendars.controller.ts
git commit -m "feat: add archive, unarchive, duplicate endpoints to CalendarsController"
```

---

## Task 4: ArchivedCalendarGuard + apply to nested controllers

**Files:**
- Create: `backend/src/common/guards/archived-calendar.guard.ts`
- Modify: `backend/src/events/events.controller.ts`
- Modify: `backend/src/event-templates/event-templates.controller.ts`
- Modify: `backend/src/feeds/feeds.controller.ts`
- Modify: `backend/src/properties/properties.controller.ts`
- Modify: `backend/src/features/features.controller.ts`
- Modify: `backend/src/target-groups/target-groups.controller.ts`
- Modify: `backend/src/locations/locations.controller.ts`

- [ ] **Create `backend/src/common/guards/archived-calendar.guard.ts`:**

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class ArchivedCalendarGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()

    // Read-only access is always allowed
    if (request.method === 'GET') return true

    const calendarId = Number(request.params.calendarId)
    if (isNaN(calendarId)) return true

    const calendar = await this.prisma.calendar.findUnique({
      where: { id: calendarId },
      select: { archivedAt: true },
    })

    if (!calendar) return true // let CalendarMemberGuard handle not-found

    if (calendar.archivedAt != null) {
      throw new ForbiddenException('Calendar is archived')
    }

    return true
  }
}
```

- [ ] **Add `ArchivedCalendarGuard` to each nested controller. Pattern — add it after the existing guards at the class level. Apply this change to all 7 files:**

For **`backend/src/events/events.controller.ts`**, **`backend/src/event-templates/event-templates.controller.ts`**, **`backend/src/feeds/feeds.controller.ts`**, **`backend/src/properties/properties.controller.ts`**, **`backend/src/features/features.controller.ts`**, **`backend/src/target-groups/target-groups.controller.ts`**, **`backend/src/locations/locations.controller.ts`**:

In each file, add `ArchivedCalendarGuard` to the imports and to the `@UseGuards(...)` decorator:

```typescript
// Add to imports at top of each file:
import { ArchivedCalendarGuard } from '../common/guards/archived-calendar.guard'

// Change the class-level decorator from:
@UseGuards(JwtAuthGuard, CalendarMemberGuard)
// to:
@UseGuards(JwtAuthGuard, CalendarMemberGuard, ArchivedCalendarGuard)
```

- [ ] **Commit:**

```bash
git add backend/src/common/guards/archived-calendar.guard.ts \
  backend/src/events/events.controller.ts \
  backend/src/event-templates/event-templates.controller.ts \
  backend/src/feeds/feeds.controller.ts \
  backend/src/properties/properties.controller.ts \
  backend/src/features/features.controller.ts \
  backend/src/target-groups/target-groups.controller.ts \
  backend/src/locations/locations.controller.ts
git commit -m "feat: ArchivedCalendarGuard blocks writes on archived calendars"
```

---

## Task 5: Block public feed access for archived calendars

**Files:**
- Modify: `backend/src/public/public.service.ts`

- [ ] **Read `backend/src/public/public.service.ts` and add `archivedAt` check.**

In both `getFeedIcs` and `getFeedEvents`, the feed is fetched with `include: { calendar: { include: { club: true } }, targetGroups: true }`. `calendar` is already included. Add the archive check immediately after the existing null check:

```typescript
// In getFeedIcs — after: if (!feed) throw notFound('Feed not found')
if (feed.calendar.archivedAt != null) throw notFound('Feed not found')

// In getFeedEvents — after: if (!feed) throw notFound('Feed not found')
if (feed.calendar.archivedAt != null) throw notFound('Feed not found')
```

- [ ] **Commit:**

```bash
git add backend/src/public/public.service.ts
git commit -m "feat: block public feed access when calendar is archived"
```

---

## Task 6: Backend tests

**Files:**
- Modify: `backend/src/routes/calendars.test.ts`
- Modify: `backend/src/routes/resources.test.ts`

- [ ] **Add the following test blocks to `backend/src/routes/calendars.test.ts`** (append after the existing DELETE block):

```typescript
import { prisma } from '../lib/prisma'  // add this import at top if not present

describe('POST /api/clubs/:clubId/calendars/:calendarId/archive', () => {
  it('sets archivedAt on the calendar', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'To Archive' })
    const res = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/archive`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { archivedAt: string }
    expect(body.archivedAt).toBeTruthy()
  })
})

describe('POST /api/clubs/:clubId/calendars/:calendarId/unarchive', () => {
  it('clears archivedAt on the calendar', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id)
    // Archive first directly
    await prisma.calendar.update({ where: { id: cal.id }, data: { archivedAt: new Date() } })
    const res = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/unarchive`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const body = res.body as { archivedAt: null }
    expect(body.archivedAt).toBeNull()
  })
})

describe('GET /api/clubs/:clubId/calendars with includeArchived', () => {
  it('excludes archived calendars by default', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const active = await createTestCalendar(club.id, { name: 'Active' })
    const archived = await createTestCalendar(club.id, { name: 'Archived' })
    await prisma.calendar.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })
    const res = await supertest(app.getHttpServer())
      .get(`/api/clubs/${club.id}/calendars`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const ids = (res.body as { id: number }[]).map((c) => c.id)
    expect(ids).toContain(active.id)
    expect(ids).not.toContain(archived.id)
  })

  it('includes archived calendars when includeArchived=true', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const archived = await createTestCalendar(club.id, { name: 'Archived2' })
    await prisma.calendar.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })
    const res = await supertest(app.getHttpServer())
      .get(`/api/clubs/${club.id}/calendars?includeArchived=true`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
    const ids = (res.body as { id: number }[]).map((c) => c.id)
    expect(ids).toContain(archived.id)
  })
})

describe('POST /api/clubs/:clubId/calendars/:calendarId/duplicate', () => {
  it('creates a new calendar named "Copy of <original>"', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'Original' })
    const res = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/duplicate`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(201)
    const body = res.body as { name: string; id: number }
    expect(body.name).toBe('Copy of Original')
    expect(body.id).not.toBe(cal.id)
  })

  it('copies properties, features, target groups to the new calendar', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'With Data' })
    await prisma.property.create({ data: { calendarId: cal.id, name: 'Prop1', icon: '🎯' } })
    await prisma.feature.create({ data: { calendarId: cal.id, name: 'Feature1' } })
    await prisma.targetGroup.create({ data: { calendarId: cal.id, name: 'Group1' } })

    const dupRes = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/duplicate`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(dupRes.status).toBe(201)
    const newId = (dupRes.body as { id: number }).id

    const props = await prisma.property.findMany({ where: { calendarId: newId } })
    const features = await prisma.feature.findMany({ where: { calendarId: newId } })
    const tgs = await prisma.targetGroup.findMany({ where: { calendarId: newId } })
    expect(props.some((p) => p.name === 'Prop1')).toBe(true)
    expect(features.some((f) => f.name === 'Feature1')).toBe(true)
    expect(tgs.some((tg) => tg.name === 'Group1')).toBe(true)
  })

  it('does not copy events', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'Has Events' })
    await prisma.event.create({
      data: { calendarId: cal.id, name: 'Event1', date: new Date('2026-07-01'), timeBegin: '10:00', timeEnd: '11:00', timezone: 'Europe/Berlin' },
    })
    const dupRes = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/duplicate`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(dupRes.status).toBe(201)
    const newId = (dupRes.body as { id: number }).id
    const events = await prisma.event.findMany({ where: { calendarId: newId } })
    expect(events).toHaveLength(0)
  })

  it('creates new feed secrets on duplicate', async () => {
    const user = await createTestUser()
    const club = await createTestClub(user.id)
    const cal = await createTestCalendar(club.id, { name: 'Has Feed' })
    const originalFeed = await prisma.calendarFeed.create({
      data: { calendarId: cal.id, name: 'My Feed', visibility: 'PUBLIC', sharedSecret: 'original-secret' },
    })
    const dupRes = await supertest(app.getHttpServer())
      .post(`/api/clubs/${club.id}/calendars/${cal.id}/duplicate`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(dupRes.status).toBe(201)
    const newId = (dupRes.body as { id: number }).id
    const newFeeds = await prisma.calendarFeed.findMany({ where: { calendarId: newId } })
    expect(newFeeds).toHaveLength(1)
    expect(newFeeds[0].name).toBe('My Feed')
    expect(newFeeds[0].sharedSecret).not.toBe(originalFeed.sharedSecret)
  })
})
```

- [ ] **Add archive-guard and public-feed tests to `backend/src/routes/resources.test.ts`** (read the file first, then append):

```typescript
// Add these imports at the top if not already present:
// import { prisma } from '../lib/prisma'
// import { createTestCalendarWithClub, getAuthHeader } from '../test/helpers'

describe('ArchivedCalendarGuard — write blocked on archived calendar', () => {
  it('returns 403 when posting event to archived calendar', async () => {
    const { user, club, calendar } = await createTestCalendarWithClub()
    await prisma.calendar.update({ where: { id: calendar.id }, data: { archivedAt: new Date() } })
    const res = await supertest(app.getHttpServer())
      .post(`/api/calendars/${calendar.id}/events`)
      .set('Authorization', await getAuthHeader(user.id))
      .send({ name: 'Blocked', date: '2026-07-01', timeBegin: '10:00', timeEnd: '11:00' })
    expect(res.status).toBe(403)
  })

  it('allows GET on archived calendar sub-resources', async () => {
    const { user, calendar } = await createTestCalendarWithClub()
    await prisma.calendar.update({ where: { id: calendar.id }, data: { archivedAt: new Date() } })
    const res = await supertest(app.getHttpServer())
      .get(`/api/calendars/${calendar.id}/events`)
      .set('Authorization', await getAuthHeader(user.id))
    expect(res.status).toBe(200)
  })
})

describe('Public feed — archived calendar', () => {
  it('returns 404 for ICS feed of archived calendar', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await prisma.calendarFeed.create({
      data: { calendarId: calendar.id, name: 'Feed', visibility: 'PUBLIC', sharedSecret: 'secret-x' },
    })
    await prisma.calendar.update({ where: { id: calendar.id }, data: { archivedAt: new Date() } })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/ics`)
    expect(res.status).toBe(404)
  })

  it('returns 404 for events feed of archived calendar', async () => {
    const { calendar } = await createTestCalendarWithClub()
    const feed = await prisma.calendarFeed.create({
      data: { calendarId: calendar.id, name: 'Feed', visibility: 'PUBLIC', sharedSecret: 'secret-y' },
    })
    await prisma.calendar.update({ where: { id: calendar.id }, data: { archivedAt: new Date() } })
    const res = await supertest(app.getHttpServer()).get(`/api/feed/${feed.id}/events`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Run the backend tests and verify they pass:**

```bash
cd backend && npm test
```

Expected: All tests pass including the new ones.

- [ ] **Commit:**

```bash
git add backend/src/routes/calendars.test.ts backend/src/routes/resources.test.ts
git commit -m "test: archive, unarchive, duplicate, guard, public feed block"
```

---

## Task 7: Frontend — Calendar type + club page UI

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/app/(auth)/clubs/[clubId]/page.tsx`

- [ ] **Add `archivedAt` to the `Calendar` interface in `frontend/src/lib/types.ts`:**

```typescript
export interface Calendar {
  id: number
  clubId: number
  name: string
  timezone?: string | null
  archivedAt?: string | null   // ← add this line
}
```

- [ ] **Replace the full contents of `frontend/src/app/(auth)/clubs/[clubId]/page.tsx`:**

```typescript
'use client'
import { use, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api'
import type { Calendar, Club, User } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CalendarDays, Check, Plus, Archive, ArchiveRestore, Copy } from 'lucide-react'

interface Props { params: Promise<{ clubId: string }> }

function formatArchivedAt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function ClubPage({ params }: Props) {
  const { clubId } = use(params)
  const qc = useQueryClient()
  const router = useRouter()
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [newCalName, setNewCalName] = useState('')
  const [calDialogOpen, setCalDialogOpen] = useState(false)
  const [clubName, setClubName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)
  const [nameSaving, setNameSaving] = useState(false)
  const [confirmDeleteCalId, setConfirmDeleteCalId] = useState<number | null>(null)
  const [confirmDeleteClub, setConfirmDeleteClub] = useState(false)
  const [deletingClub, setDeletingClub] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null)

  const { data: club } = useQuery<Club>({
    queryKey: ['club', clubId],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubId}`),
  })
  useEffect(() => { if (club) setClubName(club.name) }, [club])

  const { data: members = [] } = useQuery<User[]>({
    queryKey: ['members', clubId],
    queryFn: () => apiGet<User[]>(`/api/clubs/${clubId}/members`),
  })

  const { data: calendars = [] } = useQuery<Calendar[]>({
    queryKey: ['calendars', clubId, 'all'],
    queryFn: () => apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars?includeArchived=true`),
  })

  const activeCalendars = calendars.filter(c => !c.archivedAt)
  const archivedCalendars = calendars.filter(c => !!c.archivedAt)

  async function handleSaveClubName() {
    if (!clubName.trim() || clubName === club?.name) return
    setNameSaving(true)
    try {
      await apiPatch(`/api/clubs/${clubId}`, { name: clubName.trim() })
      qc.invalidateQueries({ queryKey: ['club', clubId] })
      qc.invalidateQueries({ queryKey: ['clubs'] })
      setNameSaved(true); setTimeout(() => setNameSaved(false), 2000)
    } finally { setNameSaving(false) }
  }

  async function handleAddMember() {
    if (!newMemberEmail.trim()) return
    setAddingMember(true); setMemberError('')
    try {
      await apiPost(`/api/clubs/${clubId}/members`, { email: newMemberEmail.trim() })
      setNewMemberEmail('')
      qc.invalidateQueries({ queryKey: ['members', clubId] })
    } catch (e: unknown) {
      setMemberError((e as Error).message ?? 'User not found')
    } finally { setAddingMember(false) }
  }

  async function handleRemoveMember(userId: number) {
    await apiDelete(`/api/clubs/${clubId}/members/${userId}`)
    qc.invalidateQueries({ queryKey: ['members', clubId] })
  }

  async function handleDeleteCalendar(calendarId: number) {
    await apiDelete(`/api/clubs/${clubId}/calendars/${calendarId}`)
    setConfirmDeleteCalId(null)
    qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
  }

  async function handleCreateCalendar() {
    if (!newCalName.trim()) return
    const cal = await apiPost<Calendar>(`/api/clubs/${clubId}/calendars`, { name: newCalName.trim() })
    setNewCalName('')
    setCalDialogOpen(false)
    qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
    router.push(`/clubs/${clubId}/calendars/${cal.id}`)
  }

  async function handleArchive(calendarId: number) {
    await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/archive`, {})
    qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
  }

  async function handleUnarchive(calendarId: number) {
    await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/unarchive`, {})
    qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
  }

  async function handleDuplicate(calendarId: number) {
    setDuplicatingId(calendarId)
    try {
      const newCal = await apiPost<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}/duplicate`, {})
      qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
      router.push(`/clubs/${clubId}/calendars/${newCal.id}`)
    } finally { setDuplicatingId(null) }
  }

  async function handleDeleteClub() {
    setDeletingClub(true)
    try {
      await apiDelete(`/api/clubs/${clubId}`)
      qc.invalidateQueries({ queryKey: ['clubs'] })
      router.replace('/clubs')
    } finally { setDeletingClub(false) }
  }

  function CalendarCard({ cal, archived = false }: { cal: Calendar; archived?: boolean }) {
    if (confirmDeleteCalId === cal.id) {
      return (
        <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-red-200 rounded-xl border">
          <span className="text-sm text-red-700">Delete <strong>{cal.name}</strong>?</span>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => handleDeleteCalendar(cal.id)} className="text-xs text-red-600 font-medium px-2 py-1 rounded hover:bg-red-100 transition-colors">Delete</button>
            <button onClick={() => setConfirmDeleteCalId(null)} className="text-xs text-slate-500 px-2 py-1 rounded hover:bg-slate-100 transition-colors">Cancel</button>
          </div>
        </div>
      )
    }

    return (
      <div className={`rounded-xl border bg-white overflow-hidden ${archived ? 'border-slate-100 opacity-70' : 'border-slate-200'}`}>
        <div className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 transition-colors">
          {archived ? (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <CalendarDays className="w-4 h-4 shrink-0 text-slate-300" />
              <div className="min-w-0">
                <span className="text-sm font-medium text-slate-500 truncate block">{cal.name}</span>
                <span className="text-xs text-slate-400">Archived · {formatArchivedAt(cal.archivedAt!)}</span>
              </div>
            </div>
          ) : (
            <button onClick={() => router.push(`/clubs/${clubId}/calendars/${cal.id}`)} className="flex items-center gap-3 flex-1 text-left min-w-0">
              <CalendarDays className="w-4 h-4 shrink-0 text-slate-400" />
              <span className="text-sm font-medium text-slate-900 truncate">{cal.name}</span>
            </button>
          )}

          <div className="flex items-center gap-1 shrink-0">
            {archived ? (
              <button onClick={() => handleUnarchive(cal.id)} title="Unarchive" className="text-slate-400 hover:text-blue-500 p-1.5 rounded hover:bg-blue-50 transition-colors">
                <ArchiveRestore className="w-3.5 h-3.5" />
              </button>
            ) : (
              <>
                <button onClick={() => handleDuplicate(cal.id)} disabled={duplicatingId === cal.id} title="Duplicate" className="text-slate-400 hover:text-slate-600 p-1.5 rounded hover:bg-slate-100 transition-colors disabled:opacity-40">
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleArchive(cal.id)} title="Archive" className="text-slate-400 hover:text-amber-500 p-1.5 rounded hover:bg-amber-50 transition-colors">
                  <Archive className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button onClick={() => setConfirmDeleteCalId(cal.id)} className="text-slate-400 hover:text-red-500 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors">Delete</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-lg">
      {/* Club name */}
      <h2 className="text-base font-semibold text-slate-900 mb-4">Club</h2>
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <div className="flex gap-2">
            <Input value={clubName} onChange={e => setClubName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveClubName()} />
            <Button size="sm" disabled={nameSaving || !clubName.trim() || clubName === club?.name} onClick={handleSaveClubName} className="gap-1.5">
              {nameSaved ? <><Check className="w-3.5 h-3.5" />Saved</> : nameSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete club */}
      <div className="mb-10">
        {!confirmDeleteClub ? (
          <button onClick={() => setConfirmDeleteClub(true)} className="text-xs text-red-400 hover:text-red-600 underline">Delete this club</button>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
            <p className="text-sm text-red-700 font-medium">This permanently deletes <strong>{club?.name}</strong> including all calendars and events. This cannot be undone.</p>
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" disabled={deletingClub} onClick={handleDeleteClub}>{deletingClub ? 'Deleting…' : 'Delete club'}</Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmDeleteClub(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {/* Members */}
      <h2 className="text-base font-semibold text-slate-900 mb-4">Members</h2>
      <div className="flex gap-2 mb-3">
        <Input placeholder="user@example.com" value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddMember()} />
        <Button size="sm" disabled={addingMember} onClick={handleAddMember}>Add</Button>
      </div>
      {memberError && <p className="text-sm text-red-500 mb-3">{memberError}</p>}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-10">
        {members.length === 0
          ? <p className="text-sm text-slate-400 p-4">No members yet.</p>
          : members.map((m: User) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">{m.name}</p>
                <p className="text-xs text-slate-500">{m.email}</p>
              </div>
              <button onClick={() => handleRemoveMember(m.id)} className="text-slate-400 hover:text-red-500 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors">Remove</button>
            </div>
          ))
        }
      </div>

      {/* Calendars */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-900">Calendars</h2>
        <Dialog open={calDialogOpen} onOpenChange={setCalDialogOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1" />}>
            <Plus className="w-3.5 h-3.5" />New
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Calendar</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <Input placeholder="Calendar name" value={newCalName} onChange={e => setNewCalName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateCalendar()} autoFocus />
              <Button className="w-full" onClick={handleCreateCalendar}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {activeCalendars.length === 0 && archivedCalendars.length === 0 && (
          <p className="text-sm text-slate-400 py-4">No calendars yet.</p>
        )}
        {activeCalendars.map(cal => <CalendarCard key={cal.id} cal={cal} />)}
      </div>

      {archivedCalendars.length > 0 && (
        <div className="mt-6 space-y-2">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Archived</p>
          {archivedCalendars.map(cal => <CalendarCard key={cal.id} cal={cal} archived />)}
        </div>
      )}
    </div>
  )
}
```

**Important:** The existing sidebar query uses `queryKey: ['calendars', clubId]`. The club page now uses `queryKey: ['calendars', clubId, 'all']` to keep them separate (the sidebar must NOT receive archived calendars). No changes needed to the sidebar.

- [ ] **Commit:**

```bash
git add frontend/src/lib/types.ts frontend/src/app/(auth)/clubs/\[clubId\]/page.tsx
git commit -m "feat: archive/unarchive/duplicate actions on club page"
```

---

## Task 8: Frontend — read-only banner on calendar view

**Files:**
- Modify: `frontend/src/app/(auth)/clubs/[clubId]/calendars/[calendarId]/page.tsx`

- [ ] **Add a calendar data fetch and read-only banner. Read the file first, then apply these changes:**

Add these imports at the top (after existing imports):
```typescript
import { apiPost } from '@/lib/api'  // add apiPost if not already imported
import type { Calendar } from '@/lib/types'  // add Calendar if not imported
import { ArchiveRestore } from 'lucide-react'  // add to lucide imports
```

Add this query inside the component (after the `targetGroups` query):
```typescript
const { data: calendar, refetch: refetchCalendar } = useQuery<Calendar>({
  queryKey: ['calendar', clubId, calendarId],
  queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
})

const isArchived = !!calendar?.archivedAt
```

Add this handler inside the component:
```typescript
async function handleUnarchive() {
  await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/unarchive`, {})
  qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
  refetchCalendar()
}
```

Add this banner JSX at the very top of the returned JSX, before the existing `<div>`:
```typescript
{isArchived && (
  <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-4">
    <p className="text-sm text-amber-800 font-medium">
      This calendar is archived — it is read-only.
    </p>
    <button
      onClick={handleUnarchive}
      className="flex items-center gap-1.5 text-xs text-amber-700 font-medium hover:text-amber-900 whitespace-nowrap"
    >
      <ArchiveRestore className="w-3.5 h-3.5" />
      Unarchive
    </button>
  </div>
)}
```

- [ ] **Run TypeScript check:**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit:**

```bash
git add frontend/src/app/(auth)/clubs/\[clubId\]/calendars/\[calendarId\]/page.tsx
git commit -m "feat: read-only banner on archived calendar view"
```

---

## Task 9: Final verification

- [ ] **Run full backend test suite:**

```bash
cd backend && npm test
```

Expected: All tests pass.

- [ ] **Start backend and do a smoke test:**

```bash
cd backend && npm run dev &
sleep 10
curl -s http://localhost:3001/health
```

Expected: `{"ok":true}`

- [ ] **Final commit if anything was missed:**

```bash
git add -A
git status  # verify only expected files
git commit -m "chore: finalize calendar archive and duplicate feature" --allow-empty
```
