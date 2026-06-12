# Club Calendar

A web app for clubs to manage and publish event calendars.

## Stack

- **Runtime:** Node.js v22, TypeScript
- **Backend:** Hono (lightweight HTTP framework)
- **Database:** Prisma ORM + MySQL 8
- **Frontend:** Next.js 15, Tailwind CSS + shadcn/ui, FullCalendar
- **Utilities:** ical-generator (ICS export), Luxon (date/time)

## Monorepo Structure

npm workspaces:
- `backend/` — Hono API server (port 3001)
- `frontend/` — Next.js app (port 3000)

## Dev Setup

```bash
# 1. Start databases
docker compose up mysql mysql_test -d

# 2. Install dependencies
npm install

# 3. Run migrations
cd backend && npx prisma migrate dev
```

## Running

```bash
# Backend (port 3001)
npm run dev:backend

# Frontend (port 3000)
npm run dev:frontend
```

## Tests

```bash
npm test
```

Tests run against a real MySQL instance on port 3307 (`club_calendar_test` database). Uses Vitest with `singleFork` pool so migrations are applied once per run.

## Domain Concepts

- **Club** — the top-level entity; has one or more Calendars; managed by Users
- **Calendar** — belongs to a Club; contains Events, EventTemplates, and reference data
- **CalendarFeed** — a publishable view of a Calendar (ICS + web); can be public or private (shared-secret protected)
- **Event** — a single occurrence on a Calendar; may be based on an EventTemplate
- **EventTemplate** — reusable event definition (name, time, location, properties)
- **Property** — a tag/attribute for events (e.g. "Schützentracht"); can have an emoji icon
- **Feature** — an optional add-on for events (e.g. "Bonusschießen")
- **TargetGroup** — audience filter for events (e.g. "Schüler", "Jugend", "Erwachsene")
- **Location** — a venue with an address; scoped to a Calendar

## Auth

- JWT-based: short-lived access token stored in `sessionStorage`, long-lived refresh token in an `httpOnly` cookie
- Secrets: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (set in `backend/.env`)

## ICS Feed Endpoint

```
GET /api/feed/:feedId/ics
GET /api/feed/:feedId/ics?secret=<token>   # for private feeds
```
