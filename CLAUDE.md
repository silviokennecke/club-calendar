# Club Calendar

A web app for clubs to manage and publish event calendars.

## Stack

- **Runtime (backend):** PHP 8.4
- **Backend:** Symfony 8.1 (attribute routing, autowiring)
- **ORM:** Doctrine ORM (attribute mapping, UnderscoreNamingStrategy)
- **DB migrations:** `doctrine/migrations`
- **JWT:** `lexik/jwt-authentication-bundle` (RSA keys)
- **OAuth SSO:** `knpuniversity/oauth2-client-bundle` + league providers
- **WebAuthn:** `web-auth/webauthn-lib`
- **ICS generation:** `eluceo/ical`
- **Validation:** `symfony/validator` (DTO constraints)
- **Tests:** PHPUnit 11 + `symfony/test-pack`
- **Runtime (frontend):** Node.js v22, TypeScript
- **Frontend:** Vite + React 19 + React Router v7, Tailwind CSS + shadcn/ui, FullCalendar (static SPA build)
- **Database:** MySQL 8

## Monorepo Structure

- `backend/` — Symfony API server (port 3001)
- `frontend/` — Next.js app (port 3000)

## Dev Setup

```bash
# 1. Start databases
docker compose up mysql mysql_test -d

# 2. Install PHP dependencies
cd backend && composer install

# 3. Run migrations
php bin/console doctrine:migrations:migrate

# 4. Load seed fixtures (optional)
php bin/console doctrine:fixtures:load

# 5. Install frontend dependencies (from repo root)
npm install
```

## Running

```bash
# Backend (port 3001)
symfony serve --port=3001 -d

# Frontend (port 3000)
npm run dev:frontend
```

## Build & Scripts

From the repo root (none require Docker):

- `npm run build:dev` / `npm run build` — dev / production build (composer install, mail templates, frontend)
- `npm run dev:frontend`, `npm test`, `npm run test:backend`, `npm run test:frontend`
- `npm run migrate`, `npm run fixtures` — Doctrine migrations / fixtures
- `npm run build:mail -w backend` — compile MJML email templates (`backend` is an npm workspace for this)

## Tests

```bash
# Backend (PHPUnit — requires MySQL test DB on port 3360)
cd backend && composer test

# Frontend (Vitest, single run; `npm run test:watch -w frontend` for watch mode)
npm test -w frontend

# All
npm test
```

Tests run against a real MySQL instance on port 3360 (`club_calendar_test` database). The root `npm test` script runs PHPUnit then Vitest.

## Working Rules

1. **Commit after every feature or fix** — create a git commit as soon as an implementation task is complete, before moving to the next task.
2. **Keep CLAUDE.md and AGENTS.md up to date** — update these files whenever the stack, architecture, or module structure changes.
3. **Write tests** — add PHPUnit integration tests for every backend feature (`tests/Controller/*.php`). E2E tests use Playwright (`frontend/e2e/`).
4. **Always use UUIDs for entity IDs** — never use auto-increment integers. Use `Uuid::v7()->toRfc4122()` assigned in the constructor, with `#[ORM\Column(length: 36)]` (no `#[ORM\GeneratedValue]`). The `getId()` return type must be `string`, not `?int`.
5. **Use shared UI components** — Before adding structural JSX or Tailwind layout patterns to a frontend page, check `frontend/src/components/ui/shared/` for existing components: `FormField`, `SectionHeader`, `EmptyState`, `ListCard`, `ListRow`, `TagBadge`, `TagBadgeRow`, `FilterPillGroup`, `DangerZoneConfirm`, `SearchInput`, `FullPageLoader`, `FullPageError`, `Alert`. Import from `@/components/ui/shared`. For Mapbox maps, use `useMapbox` from `frontend/src/components/locations/useMapbox.ts` instead of duplicating the initialization boilerplate.

## Deployment

`./deploy.sh [target] [--dry-run] [--skip-build]` builds in `.deploy/` (no-dev composer install, MJML, Vite build moved into `backend/public/`) and rsyncs to the server over SSH, then runs migrations and cache warmup. Targets are configured in the root `.env` (see `.env.example`) or real env vars (pipelines). `backend/public/.htaccess` routes `/api/*` to Symfony and everything else to the SPA's `index.html`. The server keeps its own `var/`, `.env.local` and `config/jwt/*.pem`.

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

- OAuth2-compliant: short-lived access token (15 min) + long-lived refresh token (7 days), both in `sessionStorage`
- No cookies. Frontend owns both tokens.
- Refresh: `POST /api/auth/token` (form-encoded: `grant_type=refresh_token&refresh_token=<token>`)
- Keys: RSA keypair in `backend/config/jwt/` (gitignored); `JWT_REFRESH_SECRET` for HMAC refresh tokens
- OAuth SSO: Google + Microsoft (redirect → callback → `{FRONTEND_URL}/auth/callback?token=X&refresh_token=Y`)

## ICS Feed Endpoint

```
GET /api/feed/:feedId/ics
GET /api/feed/:feedId/ics?secret=<token>   # for private feeds
```

## E2E Tests

E2E tests use Playwright. Run them while backend + frontend dev servers are running:

```bash
# Start servers first:
npm run dev:backend &
npm run dev:frontend &

# Run E2E tests:
npm run e2e -w frontend

# Interactive UI mode:
npm run e2e:ui -w frontend
```

Test files in `frontend/e2e/`:
- `auth.spec.ts` — login, redirect, error handling
- `calendar.spec.ts` — calendar navigation, event modal
- `feeds.spec.ts` — feed management, ICS URL validation
