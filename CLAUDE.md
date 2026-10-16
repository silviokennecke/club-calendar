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
  `BACKEND-GAPS.md` (open backend gaps, open security risks, operations), `E2E.md`
- `docs/api/openapi.yaml` — hand-written OpenAPI 3.1 reference of every `/api` route (schemas, error codes, auth,
  feed/robots rules, limits); not served by the app. `backend/tests/Unit/OpenApiSpecTest.php` fails when a route
  and the document drift apart: update it with every route change

## Dev Setup

```bash
# 1. Start the database (tests use a separate/throwaway MySQL on port 3360, see docs/redesign/E2E.md)
docker compose up mysql -d

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

## Configuration

Backend settings are environment variables (`backend/.env.example`, local overrides in `backend/.env.local`, gitignored). `APP_URL` is the public address of the app (SPA and API share one origin); `FRONTEND_URL`, `BACKEND_URL` and `WEBAUTHN_RP_ID` (host of `APP_URL`) default to it and only need to be set for split setups. Defaults live in `backend/config/services.yaml` (`env(...)` parameters). Optional: `MAPBOX_TOKEN`, `GOOGLE_*`, `MICROSOFT_*`, `APPLE_*` (SSO), `WEBAUTHN_USER_VERIFICATION`. In the `test` environment `TEST_DATABASE_URL` falls back to `DATABASE_URL` (`config/packages/doctrine.yaml`): the tests truncate all tables, so always point it at a separate test database.

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
- `npm run build:mail -w backend` — compile MJML email templates (confirmation code, password reset, new e-mail; compiled `*.html.twig` are committed; `backend` is an npm workspace for this)
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

Tests run against a real MySQL instance on port 3360 (`club_calendar_test` database, set via `TEST_DATABASE_URL`; falls back to `DATABASE_URL` if unset). There is no `mysql_test` compose service any more: start a throwaway container (`docker run -d --name cc-verify-mysql -p 3360:3306 -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=club_calendar_test mysql:8.0.36`), export `TEST_DATABASE_URL` in the shell and migrate with `APP_ENV=test php bin/console doctrine:migrations:migrate -n` (details: `docs/redesign/E2E.md`). The root `npm test` script runs PHPUnit then Vitest.

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

`npm run deploy` runs Deployer (`deploy.php` = config/hosts from the root `.env`, `deployer_recipe.php` = flow; `deployer/deployer` is a backend dev dependency). It checks out the committed state (`git archive`) into `.deploy/build/`, builds the mail templates and the frontend there (Vite outputs into `backend/public/`, see `frontend/vite.config.ts`), uploads `backend/` as a new release and runs composer install, migrations and cache clear/warmup on the server before switching `current`. `npm run deploy:build` only builds. Settings (`APP_URL`, `DEPLOY_HOST/USER/PATH`, ...) are documented in `.env.example`. The server keeps `.env.local` and `config/jwt/` in `shared/`; the docroot is `<DEPLOY_PATH>/current/public`. `backend/public/.htaccess` routes `/api/*` to Symfony and everything else to the SPA's `index.html`. Both the `.htaccess` and `docker/Caddyfile` send `Referrer-Policy: no-referrer` for `/feed/*` and `/api/feed/*` (other web servers, e.g. nginx: add the same header, see `docs/redesign/BACKEND-GAPS.md` "Betrieb"); `X-Robots-Tag: noindex` for the feed API comes from `FeedResponseHeadersListener` in the backend, not from the web server.

## Domain Concepts

- **Club** — the top-level entity; has one or more Calendars; managed by its members (Users via `ClubUser`, no roles yet)
- **Calendar** — belongs to a Club; contains Events, EventTemplates, and reference data; can be archived (read-only) or duplicated
- **CalendarFeed** — a publishable view of a Calendar (ICS + web) with one of three states: `PUBLIC` (by link, search
  engines may index it only with the opt-in `searchable`), `CLUB` ("Nur per Link", default: by link, never indexed)
  or `PRIVATE` (shared-secret protected); see `docs/api/openapi.yaml`
- **Event** — a single occurrence on a Calendar; may be based on an EventTemplate; may belong to an EventSeries
- **EventSeries** — a recurrence rule (weekly, every two weeks, monthly on the n-th weekday; until a date or a count; skip holidays) with the events created from it; edit/delete "only this event" or "all events of the series" (`scope`); the rule can be changed later ("Reihe ändern", `PATCH …/event-series/{id}`: only future events change, past ones stay). ICS imports with RRULE create single events, not series
- **EventTemplate** — reusable event definition (name, time, location, properties)
- **Property** — a tag/attribute for events (e.g. "Schützentracht"); can have an emoji icon
- **Feature** — an optional add-on for events (e.g. "Bonusschießen")
- **TargetGroup** — audience filter for events (e.g. "Schüler", "Jugend", "Erwachsene")
- **Location** — a venue with an address and optional map position; scoped to a Calendar
- **HolidayCalendar** — an external ICS source of holidays/school breaks for a Calendar (`HolidayEvent`s); shown in the calendar views and skipped in series previews
- **User** — signs in with password, Google/Microsoft SSO (`OAuthAccount`) or passkeys (`Passkey`); e-mail confirmation by 6-digit code (`EmailVerification`)

## Auth

- OAuth2-compliant: short-lived access token (15 min) + long-lived refresh token (7 days), both in `sessionStorage`
- No auth cookies. Frontend owns both tokens. (Only the OAuth flow sets a short-lived HttpOnly `oauth_state_nonce` cookie on the API host to bind `state` to the browser.)
- Refresh: `POST /api/auth/token` (form-encoded: `grant_type=refresh_token&refresh_token=<token>`)
- Keys: RSA keypair in `backend/config/jwt/` (gitignored); `JWT_REFRESH_SECRET` for HMAC refresh tokens
- OAuth SSO: Google + Microsoft (redirect → callback → `{FRONTEND_URL}/auth/callback?token=X&refresh_token=Y`, errors `?error=<code>`: `invalid_state`, `provider_denied`, `provider_error`, `oauth_failed`, `email_missing`, `account_exists`, `email_unverified_at_provider`, `email_verification_required`); a provider that does not prove the address (Microsoft) gets no tokens until the e-mail code was entered (user + OAuthAccount created unverified, code mailed, redirect `…?error=email_verification_required&email=<address>`; after the code the login token signs in, a passwordless SSO user keeps the provider link); trusted verified Google/Apple logins skip the code and also confirm an existing unverified account (its unproven password/passkeys/SSO links are removed first); unverified users are invisible to `addMember` (404 `member_not_found`); signed, single-use `state`; e-mail linking only with a trusted `email_verified` (Google/Apple, never Microsoft) (a former bug, see the OAuth tests)
- E-mail confirmation (all registrations, last step): a 6-digit code by mail only (CSPRNG, stored as a bcrypt hash of the `verification_code` hasher, peppered with APP_SECRET, 15 min, single use, a new code kills the old, 5 attempts then dead; per account and 24 h at most 10 codes and 20 guesses in total (`lockedUntil`: no new mail on any path incl. login/SSO, verify answers as usual, resend `429 rate_limited` + `Retry-After`); `EmailVerificationService`). `POST /api/auth/register` → 201 `{verificationRequired, email}` (no tokens); `POST /api/auth/verify-email` `{email, code}` → `{loginToken, expiresIn: 30}` (`EMAIL_VERIFICATION_LOGIN_TOKEN_TTL`), every failure `422 invalid_verification_code` (no oracle); `POST /api/auth/token` `grant_type=one_time_token&token=` redeems it once (`OneTimeTokenService`: purpose-bound, user + session version bound, `NonceStore`; reusable for the SSO code exchange) and returns the usual token pair. Resend `POST /api/auth/resend-verification`: per account at most one code mail per 5 min (`429 verification_resend_too_early` + `retryAt` + `Retry-After`), per IP 25/day (`rate_limited`); unknown/verified addresses 204. Trade-off: the too-early answer shows that an unconfirmed account exists. Login with the right password of an unverified user → 403 `email_not_verified` (+ `email`) and a fresh code is mailed if none is waiting and the cooldown passed. Refresh and passkey sign-in refuse unverified users; `app:prune-unverified-users` deletes them after 30 days (SSO-created ones too, but never club members). No link, no `GET /verify-email`.
- Notices: password changed (change / reset), e-mail change requested (to the current address) and done (to the
  former address) go out after the response (`AccountMailer`, `DeferredMailer`), without tokens or links except
  `/forgot-password`, the new address masked; none for forgot-password or to a taken new address
- Rate limits (`App\Security\AuthRateLimiter`, limiters in `config/packages/rate_limiter.yaml`; 429 `rate_limited` + `Retry-After`, checked before hashing/DB/mail, identical for unknown addresses): login 10/15 min per IP and 5/15 min per normalized e-mail (a success clears the address bucket), register 5/h per IP and 3/h per e-mail, token refresh 60/min per IP, e-mail confirmation, passkey and SSO start/callback 60/min per IP. Keyed on `Request::getClientIp()`: behind a reverse proxy set `SYMFONY_TRUSTED_PROXIES` (`framework.trusted_proxies`), else all clients share the proxy IP. E-mail max 254, password max 128 (422, no hashing). Test env: per-IP limits 100, state in `var/test-auth-limiter` (emptied by `DatabaseResetter::reset`)
- Passkeys: verified with `web-auth/webauthn-lib`; challenge in a signed, single-use `challengeToken` (`auth_nonce` table); allowed origin = `FRONTEND_URL` (default `APP_URL`), `WEBAUTHN_RP_ID` (default host of `APP_URL`), `WEBAUTHN_USER_VERIFICATION` (default `preferred`); `lastUsedAt` per passkey
- Password reset: `POST /api/auth/forgot-password` (always 204, no account oracle, mail after the response, rate-limited per address and IP) → `{FRONTEND_URL}/reset-password?token=…` (hashed one-time token, 60 min, table `password_reset`) → `POST /api/auth/reset-password` (ends all sessions, confirms the address; SSO-only accounts get a password this way). Password policy 8–128 chars everywhere (`App\Validator\PasswordPolicy`)
- Account: `PATCH /api/auth/me` (`name`, prefs, last club/calendar, the latter also per membership), `POST /api/auth/change-password` (new tokens, other sessions end; password change and reset discard a waiting e-mail change), `POST|DELETE /api/auth/change-email` + `GET /api/auth/verify-new-email` (link to the new address, table `email_change`, ends all sessions), SSO `POST /api/auth/oauth/{provider}/link-start` → ticket → provider → `/profile?link_proof=` → `POST /api/auth/oauth/{provider}/link-complete` with the JWT (only the user who started it can complete it: link-CSRF protection) / `DELETE /api/auth/oauth/{provider}` (last sign-in method stays, row lock). Details: `docs/api/openapi.yaml`
- Console: `app:user:verify <email>`, `app:user:reset-link <email>` (prints the URL only), cron `app:prune-password-resets`, `app:prune-unverified-users`

## API Errors

Every error is an RFC 7807 body (`App\Http\ProblemResponse`) with a stable `code` (and `field` for input errors) via `App\Exception\ApiProblemException`, e.g. `validation_failed`, `invalid_request`, `unknown_reference`, `duplicate_name`, `too_many_events`, `email_taken`, `invalid_credentials`, `email_not_verified` (login 403), `invalid_refresh_token`, `invalid_passkey`, `member_not_found`, `ics_fetch_failed`, `rate_limited`. A 401 of the access token is always `missing_token` / `invalid_token` / `token_expired` (`App\Security\JwtProblemListener`; also replaces the JWT bundle's bodies; the sign-in routes answer 401 `invalid_credentials` / `invalid_refresh_token` / `invalid_passkey`), every 401 with `WWW-Authenticate: Bearer`; club, calendar and geocoding routes answer 401 without a token before any id is looked up (`access_control`), 403 only to signed-in non-members. Status rule: malformed input (typed `Input` checks, incl. time zones and coordinates) is 400, DTO constraint violations and state conflicts 422; every 400 has a code (framework 400s `invalid_request`, array query parameters `validation_failed` + `field`). The frontend matches `ApiError.code`, never `detail`. Full list: `ErrorCode` in `docs/api/openapi.yaml`.

## Event Import, Export, Bulk, Series

```
POST /api/calendars/:id/events/import/preview   # {events, locations?} → status per entry (new|duplicate|invalid), writes nothing
POST /api/calendars/:id/events/import           # {events, locations?: [{tempId, name, …}], skipDuplicates?} → one transaction
GET  /api/calendars/:id/events.ics?from&to&includeDrafts&targetGroupIds[]   # member ICS download
POST /api/calendars/:id/events/bulk             # {ids, action: publish|draft|delete} → {affected}, all or nothing
POST /api/calendars/:id/events/series/preview   # {rule} → {dates, count, skippedHolidays, holidays}, writes nothing
POST /api/calendars/:id/events/series           # {rule, templateId?, event?, isDraft?} → {series, events}, atomic, max. 366
GET  /api/calendars/:id/event-series/:seriesId  # rule + eventCount
PATCH|DELETE /api/calendars/:id/events/:eventId # scope this (default) | all (PATCH body, DELETE ?scope=)
```

Duplicates: same `externalUid` (ICS UID, stored on `Event`) or same name + start date. Unknown time zones in the import fall back to the calendar zone with a `warnings` entry. Limits: 5000 events per import/preview and 5000 ids per bulk request (413 `too_many_events`), 366 events per series (422 `too_many_events`). Series dates are computed only by the backend (`App\Service\SeriesRule`); `scope: "all"` never changes an event's date; empty series are removed. Details: `docs/api/openapi.yaml`.

## ICS Feed Endpoint

```
GET /api/feed/:feedId/ics
GET /api/feed/:feedId/ics?secret=<token>   # for private feeds
GET /api/feed/:feedId/events[?from=YYYY-MM-DD&to=YYYY-MM-DD]   # web view: header (club, calendar, zone, visibility), events, holidays
GET /api/feed/:feedId/events/:eventId                          # one published event (secret checked first)
```

Feed management responses (`/api/calendars/:id/feeds…`) omit `sharedSecret` unless `?includeSecret=1|true` is sent (the frontend sends it where it shows or copies the feed address).

Counters for lists and delete dialogs (clubs, calendars, `usage` of reference data, `eventCount` of templates) come
from the API in one grouped query per counter (`App\Service\UsageCounts`); the frontend never loads whole lists just
to count. Details: `docs/api/openapi.yaml`.

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

Specs in `frontend/e2e/`: `auth`, `onboarding`, `calendar`, `events`, `series-change`, `templates`, `import`,
`import-rrule`, `import-keyboard`, `import-large`, `error-page`, `dialog-stack`, `settings`, `feeds`, `club`, `profile`,
`public`, `regressions`, `session-revoked`, `stale-assignments`, `account` (`*.spec.ts`); helpers in `helpers.ts`, guard in `safety.ts` / `global-setup.ts`.
