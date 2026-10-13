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
- **Frontend:** Vite SPA + React 19 + React Router v7 (data router, routed modals), TanStack Query, Tailwind CSS v4
  with the redesign's design tokens (`src/index.css`), shared building blocks on a minimal shadcn/Base UI basis,
  i18next (de/en), light/dark/system theme; own month/week calendar views (no FullCalendar); Mapbox GL and emoji-mart
  loaded lazily; route-level code splitting (`src/pages/lazy.ts`)
- **Frontend tests:** Vitest + Testing Library, Playwright (E2E)
- **Database:** MySQL 8

## Monorepo Structure

- `backend/` — Symfony API server (port 3001); also serves the built SPA from `backend/public/`
- `frontend/` — Vite/React single-page app (dev server port 5173, `npm run dev:frontend`); conventions in
  `frontend/AGENTS.md`
- `docs/redesign/` — redesign plan and final state: `PLAN.md`, `COVERAGE.md` (design coverage per artboard),
  `BACKEND-GAPS.md` (missing backend features, open security risks, fixed backend bugs, operations), `E2E.md`

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

# 6. Frontend API URL (VITE_API_URL=http://localhost:3001)
cp frontend/.env.local.example frontend/.env.local
```

JWT keys: `cd backend && php bin/console lexik:jwt:generate-keypair` (see README.md).

## Running

```bash
# Backend (port 3001)
cd backend && symfony serve --port=3001 -d

# Frontend (Vite dev server, http://localhost:5173)
npm run dev:frontend
```

## Build & Scripts

From the repo root (none require Docker):

- `npm run build:dev` / `npm run build` — dev / production build (composer install, mail templates, frontend)
- `npm run dev:frontend`, `npm test`, `npm run test:backend`, `npm run test:frontend`
- `npm run migrate`, `npm run fixtures` — Doctrine migrations / fixtures
- `npm run build:mail -w backend` — compile MJML email templates (`backend` is an npm workspace for this)
- `npm run lint -w frontend` — ESLint (`--max-warnings 0`) + Prettier check; `npm run format -w frontend` fixes formatting

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
5. **Use shared UI components** — Before adding structural JSX or Tailwind layout patterns to a frontend page, check `frontend/src/components/ui/shared/` (exports in `index.ts`, table in `frontend/AGENTS.md`), e.g. `Button`/`LinkButton`/`IconButton`, `SplitButton`, `Field` + `TextInput`/`TextArea`/`NativeSelect`, `PasswordField`, `Toggle`, `Tag`, `StatusBadge`, `Banner`, `toast`, `EmptyState`, `ConfirmDialog`, `FormDialog`, `Modal`/`ModalFrame`/`DialogFrame`, `CopyField`, `Chip`/`ChipSelect`, `FilterPillGroup`, `SearchInput`, `EmojiPicker`, `Stepper`, `LangSwitch`, `ThemeSwitch`, `Skeleton`, `FullPageLoader`, `ErrorSummary`, `UnsavedChangesDialog`, `Logo`, `Icon`. Import from `@/components/ui/shared`. For Mapbox maps, use `useMapbox` from `frontend/src/components/locations/useMapbox.ts` instead of duplicating the initialization boilerplate.
6. **Texts via i18n** — every UI text is a key in `frontend/src/locales/de.json` and `en.json` (identical keys and placeholders, enforced by `src/lib/__tests__/i18n.test.ts`); remove keys that are no longer used.

## Docker

`docker/` holds everything for the container image (`Dockerfile`, `Caddyfile`, `php-fpm.conf`, `php.ini`, `entrypoint.sh`, `Dockerfile.dockerignore`). Build from the repo root: `docker build -f docker/Dockerfile -t club-calendar .`. Multi-stage (composer, Node/Vite, Caddy) into `php:8.4-fpm-alpine`: Caddy serves the SPA and proxies `/api/*` to PHP-FPM on one origin, running as `www-data` on port 8080. The SPA is built with an empty `VITE_API_URL`, which `frontend/src/lib/apiUrl.ts` resolves to `window.location.origin`, so the image is domain-independent. The entrypoint also generates JWT keys if missing (mount a volume at `config/jwt`) and runs migrations (`RUN_MIGRATIONS=0` disables). Required env vars are listed at the top of `entrypoint.sh`. `.github/workflows/docker.yml` pushes `ghcr.io/<owner>/<repo>` (main → `latest`, `v*` tags → semver).

## Deployment

`npm run deploy` runs Deployer (`deploy.php` = config/hosts from the root `.env`, `deployer_recipe.php` = flow; `deployer/deployer` is a backend dev dependency). It checks out the committed state (`git archive`) into `.deploy/build/`, builds the mail templates and the frontend there (Vite outputs into `backend/public/`, see `frontend/vite.config.ts`), uploads `backend/` as a new release and runs composer install, migrations and cache clear/warmup on the server before switching `current`. `npm run deploy:build` only builds. Settings (`APP_URL`, `DEPLOY_HOST/USER/PATH`, ...) are documented in `.env.example`. The server keeps `.env.local` and `config/jwt/` in `shared/`; the docroot is `<DEPLOY_PATH>/current/public`. `backend/public/.htaccess` routes `/api/*` to Symfony and everything else to the SPA's `index.html`.

## Domain Concepts

- **Club** — the top-level entity; has one or more Calendars; managed by its members (Users via `ClubUser`, no roles yet)
- **Calendar** — belongs to a Club; contains Events, EventTemplates, and reference data; can be archived (read-only) or duplicated
- **CalendarFeed** — a publishable view of a Calendar (ICS + web); can be public or private (shared-secret protected)
- **Event** — a single occurrence on a Calendar; may be based on an EventTemplate
- **EventTemplate** — reusable event definition (name, time, location, properties)
- **Property** — a tag/attribute for events (e.g. "Schützentracht"); can have an emoji icon
- **Feature** — an optional add-on for events (e.g. "Bonusschießen")
- **TargetGroup** — audience filter for events (e.g. "Schüler", "Jugend", "Erwachsene")
- **Location** — a venue with an address and optional map position; scoped to a Calendar
- **HolidayCalendar** — an external ICS source of holidays/school breaks for a Calendar (`HolidayEvent`s); shown in the calendar views and skipped in series previews
- **User** — signs in with password, Google/Microsoft SSO (`OAuthAccount`) or passkeys (`Passkey`); e-mail double opt-in (`EmailVerification`)

## Auth

- OAuth2-compliant: short-lived access token (15 min) + long-lived refresh token (7 days), both in `sessionStorage`
- No auth cookies. Frontend owns both tokens. (Only the OAuth flow sets a short-lived HttpOnly `oauth_state_nonce` cookie on the API host to bind `state` to the browser.)
- Refresh: `POST /api/auth/token` (form-encoded: `grant_type=refresh_token&refresh_token=<token>`)
- Keys: RSA keypair in `backend/config/jwt/` (gitignored); `JWT_REFRESH_SECRET` for HMAC refresh tokens
- OAuth SSO: Google + Microsoft (redirect → callback → `{FRONTEND_URL}/auth/callback?token=X&refresh_token=Y`, errors `?error=<code>`: `invalid_state`, `provider_denied`, `provider_error`, `oauth_failed`, `email_missing`, `account_exists`, `email_unverified_at_provider`); signed, single-use `state`; e-mail linking only with a trusted `email_verified` (Google/Apple, never Microsoft), see `docs/redesign/BACKEND-GAPS.md` (Sicherheit)
- Passkeys: verified with `web-auth/webauthn-lib`; challenge in a signed, single-use `challengeToken` (`auth_nonce` table); allowed origin = `FRONTEND_URL`, `WEBAUTHN_RP_ID`, `WEBAUTHN_USER_VERIFICATION` (default `preferred`)

## API Errors

RFC 7807 bodies carry a stable `code` (and `field` for input errors) via `App\Exception\ApiProblemException`, e.g. `validation_failed`, `invalid_request`, `unknown_reference`, `duplicate_name`, `too_many_events`, `email_taken`, `invalid_credentials`, `email_not_verified` (login 403 keeps `{error: "email_not_verified"}` too), `invalid_refresh_token`, `invalid_passkey`. The frontend matches `ApiError.code`, never `detail`. Full list: `docs/redesign/BACKEND-GAPS.md` (Fehlercodes).

## Event Import, Export, Bulk

```
POST /api/calendars/:id/events/import/preview   # {events, locations?} → status per entry (new|duplicate|invalid), writes nothing
POST /api/calendars/:id/events/import           # {events, locations?: [{tempId, name, …}], skipDuplicates?} → one transaction
GET  /api/calendars/:id/events.ics?from&to&includeDrafts&targetGroupIds[]   # member ICS download
POST /api/calendars/:id/events/bulk             # {ids, action: publish|draft|delete} → {affected}, all or nothing
```

Duplicates: same `externalUid` (ICS UID, stored on `Event`) or same name + start date. Unknown time zones in the import fall back to the calendar zone with a `warnings` entry. Limits: 5000 events per import/preview and 5000 ids per bulk request (413 `too_many_events`).

## ICS Feed Endpoint

```
GET /api/feed/:feedId/ics
GET /api/feed/:feedId/ics?secret=<token>   # for private feeds
GET /api/feed/:feedId/events[?from=YYYY-MM-DD&to=YYYY-MM-DD]   # web view: header (club, calendar, zone, visibility), events, holidays
GET /api/feed/:feedId/events/:eventId                          # one published event (secret checked first)
```

Counters for lists and delete dialogs (clubs, calendars, `usage` of reference data, `eventCount` of templates) come
from the API in one grouped query per counter (`App\Service\UsageCounts`); the frontend never loads whole lists just
to count. Details: `docs/redesign/BACKEND-GAPS.md` ("Umgesetzt (Paket 1)").

## E2E Tests

Playwright (`frontend/e2e/`). The suite registers users and writes data, so it runs **only against an isolated local
environment**: own database `club_calendar_e2e` on the test MySQL (port 3360), backend via `php -S 127.0.0.1:3001`,
Vite on port 5199. `e2e/global-setup.ts` aborts when `PLAYWRIGHT_BASE_URL`, `E2E_API_URL`, `VITE_API_URL` or the API
URL of the running Vite server is not on localhost (`frontend/.env.local` points at the dev API). Step-by-step setup
and cleanup: `docs/redesign/E2E.md` (also in `frontend/AGENTS.md`).

```bash
PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend   # after the setup from E2E.md
npm run e2e:ui -w frontend                                          # interactive UI mode
```

Specs in `frontend/e2e/`: `auth`, `onboarding`, `calendar`, `events`, `templates`, `import`, `import-keyboard`,
`import-large`, `error-page`, `settings`, `feeds`, `club`, `profile`, `public`, `regressions`, `session-revoked`,
`stale-assignments` (`*.spec.ts`); helpers in `helpers.ts`, guard in `safety.ts` / `global-setup.ts`.
