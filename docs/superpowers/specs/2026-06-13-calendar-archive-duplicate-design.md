# Calendar Archive & Duplicate — Design Spec

**Date:** 2026-06-13  
**Status:** Approved

---

## Overview

Two new calendar-level operations:

- **Archive** — soft-hides a calendar. It remains accessible from the club page but disappears from the sidebar, becomes read-only, and its public feeds stop serving data.
- **Duplicate** — deep-copies a calendar and all its reference data (properties, features, target groups, locations, event templates, feeds) into the same club, without copying events. The user is immediately navigated to the new calendar.

---

## Data Model

Add to `Calendar` in `prisma/schema.prisma`:

```prisma
archivedAt DateTime? // null = active; set = archived
```

A nullable timestamp rather than a boolean so the club page can display "Archived Jun 2026". `isArchived` is derived as `archivedAt != null`.

Migration: `ALTER TABLE Calendar ADD COLUMN archivedAt DATETIME NULL`.

---

## Backend

### API Endpoints

All under `@Controller('api/clubs/:clubId/calendars')`, protected by `JwtAuthGuard` + `ClubMemberGuard`:

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| `POST` | `/:calendarId/archive` | 200 | Set `archivedAt = now()`; return updated calendar |
| `POST` | `/:calendarId/unarchive` | 200 | Set `archivedAt = null`; return updated calendar |
| `POST` | `/:calendarId/duplicate` | 201 | Deep-copy; return new calendar |

### `listCalendars` change

Accepts an optional `includeArchived: boolean` parameter (default `false`).

```
GET /api/clubs/:clubId/calendars              → active only
GET /api/clubs/:clubId/calendars?includeArchived=true → all
```

Order: `[{ archivedAt: 'asc' nulls first }, { name: 'asc' }]` — active calendars come first, archived sorted last.

### `ArchivedCalendarGuard`

A new NestJS guard applied to **all nested calendar routes** (events, templates, locations, properties, features, target-groups, feeds). Logic:

- Reads `calendarId` from `request.params.calendarId`
- Fetches `Calendar.archivedAt` from Prisma
- On `GET` requests: always passes through (read-only access allowed)
- On any other method (`POST`, `PATCH`, `DELETE`): throws `403 Forbidden` if `archivedAt != null`

Applied at class level on: `EventsController`, `EventTemplatesController`, `FeedsController`, `PropertiesController`, `FeaturesController`, `TargetGroupsController`, `LocationsController`.

### Public Feed Block

In `PublicService.getFeedIcs` and `PublicService.getFeedEvents`: fetch includes `feed.calendar`. If `feed.calendar.archivedAt != null` → throw `notFound('Feed not found')` (same 404 as a missing feed — no information leak).

### Duplicate Logic

`CalendarsService.duplicateCalendar(calendarId, clubId)` — single Prisma `$transaction`:

1. Fetch source calendar with all relations:
   - `properties`, `features`, `targetGroups`, `locations`
   - `templates` (include `properties`, `features`, `targetGroups`)
   - `feeds` (include `targetGroups`)
2. Create new `Calendar` with `name = "Copy of <original>"`, same `timezone`, `archivedAt = null`
3. Create properties → build `oldId → newId` map
4. Create features → build map
5. Create target groups → build map
6. Create locations (all fields; no relational data) → build map
7. Create event templates with relations mapped through the above maps
8. Create feeds with fresh `sharedSecret = randomUUID()`, same `name`/`visibility`; map feed target group IDs
9. Return the new calendar

**Important:** Location IDs on templates are remapped to the new location IDs. The ID maps ensure template relations point to the new calendar's copies, not the originals.

---

## Frontend

### Club Page (`/clubs/[clubId]/page.tsx`)

- Fetch `GET /api/clubs/:clubId/calendars?includeArchived=true`
- Split into `activeCalendars` and `archivedCalendars` (by presence of `archivedAt`)
- Render active calendars first, then an "Archived" section (always visible) containing archived calendars

**Active calendar card actions:**
- Navigate (click card)
- Duplicate (copy icon → POST duplicate → navigate to new calendar)
- Archive (archive icon → POST archive → invalidate query)
- Delete (existing)

**Archived calendar card appearance:**
- Muted/greyed card style
- Badge: `Archived · Jun 2026` (formatted from `archivedAt`)

**Archived calendar card actions:**
- Unarchive (POST unarchive → invalidate query)
- Delete (existing)
- No navigate-to-calendar action (clicking opens the confirm-delete flow or does nothing)

### Sidebar (`CalendarSidebar.tsx`)

No change — continues fetching without `includeArchived`, so archived calendars are invisible.

### Calendar View — Read-Only Banner

When the loaded calendar has `archivedAt != null`, display a persistent banner at the top of the calendar view:

> "This calendar is archived and read-only."  
> [Unarchive] button → `POST /api/clubs/:clubId/calendars/:calendarId/unarchive` → invalidates calendar query + navigates to same calendar

The banner is non-dismissible (it reappears on reload since the state is server-side).

### Type Update

Add to `Calendar` in `frontend/src/lib/types.ts`:

```typescript
archivedAt?: string | null  // ISO date string or null
```

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Write to archived calendar | 403 from `ArchivedCalendarGuard` |
| Access archived calendar's public feed | 404 (same as missing feed) |
| Duplicate non-existent calendar | 403 from `verifyCalendarBelongsToClub` |

---

## Out of Scope

- Archiving/restoring events within a calendar
- Moving a calendar to a different club during duplication
- Bulk archive
- Archived calendar count badge in sidebar
