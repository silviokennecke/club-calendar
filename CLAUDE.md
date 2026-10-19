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
- **Database:** MySQL 8 or MariaDB (no `server_version` in `doctrine.yaml`: DBAL detects the platform; a fixed `8.0` broke MariaDB introspection)

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

Backend settings are environment variables (`backend/.env.example`, local overrides in `backend/.env.local`, gitignored). `APP_URL` is the public address of the app (SPA and API share one origin); `FRONTEND_URL`, `BACKEND_URL` and `WEBAUTHN_RP_ID` (host of `APP_URL`) default to it and only need to be set for split setups. Defaults live in `backend/config/services.yaml` (`env(...)` parameters). Host header (audit M2): links in mails, redirects and the OAuth `redirect_uri` are built only from these URLs (`RequestContextListener` pins the router's request context to `BACKEND_URL`), and `framework.trusted_hosts` accepts only the hosts of `APP_URL`/`FRONTEND_URL`/`BACKEND_URL`, the comma-separated extra hosts in optional `TRUSTED_HOSTS` (e.g. a `www` alias) and loopback (`localhost`, `127.0.0.1`, `[::1]`: container health check, dev, E2E); any other `Host` is a 400 (`App\Security\TrustedHostsEnvVarProcessor`). A production host reachable under another name must be listed in `TRUSTED_HOSTS`. Optional: `MAPBOX_TOKEN`, `GOOGLE_*`, `MICROSOFT_*`, `APPLE_*` (SSO), `WEBAUTHN_USER_VERIFICATION`. In the `test` environment `TEST_DATABASE_URL` falls back to `DATABASE_URL` (`config/packages/doctrine.yaml`): the tests truncate all tables, so always point it at a separate test database.

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
- `npm run build:mail -w backend` — compile MJML email templates (confirmation code, password reset, new e-mail; compiled `*.html.twig` are committed; `backend` is an npm workspace for this); the header logo is the PNG `backend/assets/mail/logo.png` (email clients do not render SVG), embedded inline as a CID attachment via `email.image('@mail_assets/logo.png')` (Twig path `mail_assets` in `config/packages/twig.yaml`), so there are no external image hosts
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
7. **Orchestrate, don't implement** — you are the orchestrator/manager. All work is done by subagents (Haiku or Sonnet; ask before using Opus). Pick the most efficient model for every task. Every subagent gets exactly one specific task, to keep its context small.
8. **Unsigned commits as fallback** — if committing fails due to signing issues, commit without signing the commit.

## Docker

`docker/` holds everything for the container image (`Dockerfile`, `Caddyfile`, `php-fpm.conf`, `php.ini`, `entrypoint.sh`, `Dockerfile.dockerignore`). Build from the repo root: `docker build -f docker/Dockerfile -t club-calendar .`. Multi-stage (composer, Node/Vite, Caddy) into `php:8.4-fpm-alpine`: Caddy serves the SPA and proxies `/api/*` to PHP-FPM on one origin, running as `www-data` on port 8080. The SPA is built with an empty `VITE_API_URL`, which `frontend/src/lib/apiUrl.ts` resolves to `window.location.origin`, so the image is domain-independent. The entrypoint also generates JWT keys if missing (mount a volume at `config/jwt`) and runs migrations (`RUN_MIGRATIONS=0` disables). Required env vars are listed at the top of `entrypoint.sh`. `.github/workflows/docker.yml` pushes `ghcr.io/<owner>/<repo>` (main → `latest`, `v*` tags → semver).

## Deployment

There is no deploy tooling in the repo any more (Deployer was removed in b51cc47; no `deploy` scripts in `package.json`). Build with `npm run build` (Vite outputs into `backend/public/`, see `frontend/vite.config.ts`) or use the Docker image, and run composer install, migrations and cache clear/warmup on the target (keep `.env.local` and `config/jwt/` outside the release). Settings are documented in `.env.example`; the docroot is `backend/public`. `backend/public/.htaccess` routes `/api/*` to Symfony and everything else to the SPA's `index.html`. Both the `.htaccess` and `docker/Caddyfile` send `Referrer-Policy: no-referrer` for `/feed/*` and `/api/feed/*` (other web servers, e.g. nginx: add the same header, see `docs/redesign/BACKEND-GAPS.md` "Betrieb"); `X-Robots-Tag: noindex` for the feed API comes from `FeedResponseHeadersListener` in the backend, not from the web server.

Security headers (audit M4) live in both `backend/public/.htaccess` and `docker/Caddyfile` and must stay identical (`backend/tests/Unit/SecurityHeadersConfigTest.php`): `Content-Security-Policy` (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` (React `style=`, emoji-mart and mapbox-gl inject styles); `img-src 'self' data: blob:`; `connect-src 'self'`; `worker-src 'self' blob:`; `frame-ancestors 'none'`; `object-src 'none'`, ...), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin` (the OAuth flow is a full-page redirect, no popups) and a default `Referrer-Policy: strict-origin-when-cross-origin` (feeds keep `no-referrer`). There are no third-party hosts: Mapbox goes through `/api/mapbox` (tiles/styles/fonts: signed-in users only, 401 `missing_token` otherwise; anonymous pages use the public static images `/api/map/image/*`), emoji-mart data is bundled, fonts are self-hosted. CSP rules for contributors: no inline `<script>` and no `eval` (the theme bootstrap is `frontend/public/theme-init.js`); a new third-party host must be added to the policy in BOTH files and the test; split setups (`VITE_API_URL` on another origin) must add that origin to `connect-src`. HSTS is set by `.htaccess` only for HTTPS requests; Caddy runs behind a TLS terminator, which must send `Strict-Transport-Security` (see `docs/redesign/BACKEND-GAPS.md` "Betrieb"). `.htaccess` also denies `*.env`, `*.pem`, `*.log`.

## Domain Concepts

- **Club** — the top-level entity; has one or more Calendars; managed by its members (Users via `ClubUser` with role `viewer`/`editor`/`admin`; viewer reads; editor also writes events, series, templates, locations, properties, features, target groups, holiday calendars and reads feeds; admin also manages calendars, members, invitations and club settings); members join only by accepting an **Invitation** (no direct add); a club never has zero members: the last member cannot be removed or leave (422 `last_member`, club row locked for the check), the last admin cannot be demoted/removed/leave while others remain (422 `last_admin`), and `DELETE /api/auth/me` is refused with 422 `last_admin_of_club` while the user is the last admin of a club (delete the club first or demote to a lower role)
- **ClubInvitation** — an invitation of an e-mail address to a club (see "Club invitations" below); pending, accepted or declined, valid 7 days, an expired one stays listed and can be re-sent
- **Calendar** — belongs to a Club; contains Events, EventTemplates, Properties, Features, HolidayCalendars, and reference data per calendar; can be archived (read-only) or duplicated
- **CalendarFeed** — a publishable view of 1..n Calendars of a Club (ICS + web) with one of three states: `PUBLIC` (by link, search
  engines may index it), `CLUB` ("Nur per Link", default: by link, never indexed)
  or `PRIVATE` (shared-secret protected); the web view merges published events and holiday events of all selected non-archived calendars; ICS lists events only, never holidays; scoped to a Club; see `docs/api/openapi.yaml`
- **Event** — a single occurrence on a Calendar; optional plain-text `note` (max 2000 chars, trimmed, empty = null; copied from the template; ICS `DESCRIPTION`, shown in the public feed); may be based on an EventTemplate; may belong to an EventSeries
- **EventSeries** — a recurrence rule (weekly, every two weeks, monthly on the n-th weekday; until a date or a count; skip holidays) with the events created from it; edit/delete "only this event" or "all events of the series" (`scope`); the rule can be changed later ("Reihe ändern", `PATCH …/event-series/{id}`: only future events change, past ones stay). ICS imports with RRULE create single events, not series
- **EventTemplate** — reusable event definition (name, time, location, properties, optional `note`)
- **Property** — a tag/attribute for events (e.g. "Schützentracht"); can have an emoji icon
- **Feature** — an optional add-on for events (e.g. "Bonusschießen")
- **TargetGroup** — audience filter for events (e.g. "Schüler", "Jugend", "Erwachsene"); scoped to a Club
- **Location** — a venue with an address and optional map position; scoped to a Club
- **HolidayCalendar** — an external ICS source of holidays/school breaks for a Calendar (`HolidayEvent`s); shown in the calendar views and skipped in series previews
- **User** — signs in with password, Google/Microsoft SSO (`OAuthAccount`) or passkeys (`Passkey`); e-mail confirmation by 6-digit code (`EmailVerification`)

## Auth

- OAuth2-compliant: short-lived access token (15 min) + refresh token (7 days, sliding), both in `sessionStorage`
- No auth cookies. Frontend owns both tokens. (Only the OAuth flow sets a short-lived HttpOnly `oauth_state_nonce` cookie on the API host to bind `state` to the browser.)
- Refresh: `POST /api/auth/token` (form-encoded: `grant_type=refresh_token&refresh_token=<token>`)
- Keys: RSA keypair in `backend/config/jwt/` (gitignored); `JWT_REFRESH_SECRET` for HMAC refresh tokens
- Refresh tokens are stored (`refresh_token`, id = `jti`, `family_id` = `fam` per session) and rotated on every use (single-use via a conditional `UPDATE ... rotated_at IS NULL`; `AuthService::refresh`). A session ends at the latest `REFRESH_TOKEN_ABSOLUTE_LIFETIME` (default 30 days) after login. Presenting an already rotated token revokes the whole family (401 `invalid_refresh_token`), except within `REFRESH_TOKEN_REUSE_GRACE` seconds (default 10) after the rotation: that retry (lost response, parallel tabs) gets another token of the family without revoking. Trade-off: a thief who replays a token inside that window also gets a token (the victim's next refresh then forks the family; only reuse after the window is detected). Every issuance (login, `one_time_token`, SSO, password change, passkey login/deletion) starts a family via `TokenService::tokenResponse`. Legacy tokens without `jti` (from before the rotation) are accepted exactly once (`NonceStore`, a replay is 401) and replaced by a token of a new family (not tracked by family, so `/logout` with one does nothing; bounded by their own 7-day expiry). Known trade-off: a duplicated browser tab copies `sessionStorage`; two tabs refreshing more than the grace apart count as reuse and both sign out. `POST /api/auth/logout` (`{refresh_token}`, always 200) revokes the family, `POST /api/auth/logout-all` (JWT, 204) bumps `tokenVersion` and revokes all families; the token version (`tv`, checked on access tokens and on refresh) also ends on password change/reset, e-mail change, passkey deletion and SSO takeover
- OAuth SSO: Google + Microsoft (redirect → callback → `{FRONTEND_URL}/auth/callback?code=<one-time code>` (`OneTimeTokenService` purpose `login.oauth`, env `OAUTH_LOGIN_CODE_TTL` default 180 s, single use; the SPA removes it from the URL and redeems it at `POST /api/auth/token` `grant_type=one_time_token`, no token ever in a URL), errors `?error=<code>`: `invalid_state`, `provider_denied`, `provider_error`, `oauth_failed`, `email_missing`, `account_exists`, `email_unverified_at_provider`, `email_verification_required`); a provider that does not prove the address (Microsoft) gets no tokens until the e-mail code was entered (user + OAuthAccount created unverified, code mailed, redirect `…?error=email_verification_required&email=<address>`; after the code the login token signs in, a passwordless SSO user keeps the provider link); trusted verified Google/Apple logins skip the code and also confirm an existing unverified account (its unproven password/passkeys/SSO links are removed first); unverified users never see or accept club invitations (verified address required); signed, single-use `state`; e-mail linking only with a trusted `email_verified` (Google/Apple, never Microsoft) (a former bug, see the OAuth tests)
- E-mail confirmation (all registrations, last step): a 6-digit code by mail only (CSPRNG, stored as a bcrypt hash of the `verification_code` hasher, peppered with APP_SECRET, 15 min, single use, a new code kills the old, 5 attempts then dead; per account and 24 h at most 10 codes and 20 guesses in total (`lockedUntil`: no new mail on any path incl. login/SSO, verify answers as usual, resend `429 rate_limited` + `Retry-After`); `EmailVerificationService`). `POST /api/auth/register` → 201 `{verificationRequired, email}` (no tokens); `POST /api/auth/verify-email` `{email, code}` → `{loginToken, expiresIn: 30}` (`EMAIL_VERIFICATION_LOGIN_TOKEN_TTL`), every failure `422 invalid_verification_code` (no oracle); `POST /api/auth/token` `grant_type=one_time_token&token=` redeems it once (`OneTimeTokenService`: purpose-bound, user + session version bound, `NonceStore`; reusable for the SSO code exchange) and returns the usual token pair. Resend `POST /api/auth/resend-verification`: per account at most one code mail per 5 min (`429 verification_resend_too_early` + `retryAt` + `Retry-After`), per IP 25/day (`rate_limited`); unknown/verified addresses 204. Trade-off: the too-early answer shows that an unconfirmed account exists. Login with the right password of an unverified user → 403 `email_not_verified` (+ `email`) and a fresh code is mailed if none is waiting and the cooldown passed. Refresh and passkey sign-in refuse unverified users; `app:prune-unverified-users` deletes them after 30 days (SSO-created ones too, but never club members). No link, no `GET /verify-email`.
- Notices: password changed (change / reset), e-mail change requested (to the current address) and done (to the
  former address) go out after the response (`AccountMailer`, `DeferredMailer`), without tokens or links except
  `/forgot-password`, the new address masked; none for forgot-password or to a taken new address
- Rate limits (`App\Security\AuthRateLimiter`, limiters in `config/packages/rate_limiter.yaml`; 429 `rate_limited` + `Retry-After`, checked before hashing/DB/mail, identical for unknown addresses): login 10/15 min per IP and 5/15 min per normalized e-mail (a success clears the address bucket), register 5/h per IP and 3/h per e-mail, token refresh 60/min per IP, e-mail confirmation, passkey and SSO start/callback 60/min per IP. Keyed on `Request::getClientIp()`: behind a reverse proxy set `SYMFONY_TRUSTED_PROXIES` (`framework.trusted_proxies`), else all clients share the proxy IP. E-mail max 254, password max 128 (422, no hashing). Test env: per-IP limits 100, state in `var/test-auth-limiter` (emptied by `DatabaseResetter::reset`)
- Passkeys: verified with `web-auth/webauthn-lib`; challenge in a signed, single-use `challengeToken` (`auth_nonce` table); allowed origin = `FRONTEND_URL` (default `APP_URL`), `WEBAUTHN_RP_ID` (default host of `APP_URL`), `WEBAUTHN_USER_VERIFICATION` (default `preferred`); `lastUsedAt` per passkey
- Password reset: `POST /api/auth/forgot-password` (always 204, no account oracle, mail after the response, rate-limited per address and IP) → `{FRONTEND_URL}/reset-password?token=…` (hashed one-time token, 60 min, table `password_reset`) → `POST /api/auth/reset-password` (ends all sessions, confirms the address; SSO-only accounts get a password this way). Password policy 8–128 chars everywhere (`App\Validator\PasswordPolicy`)
- Account deletion (AUTH-03): `DELETE /api/auth/me` needs re-authentication (`AccountDeletionService`): an account with a password sends `{password}` (wrong/missing: 400 `invalid_credentials`, field `password`); an account without one (SSO-only/passkey-only) sends `{code}`, a 6-digit code mailed by `POST /api/auth/delete-account/code` (409 `has_password` for password accounts; 5 mails/h per user). The code is stateless: an HMAC of APP_SECRET over user, token version, address and a 10-minute window, valid 10-20 min, dead after a password set, sign-out of all sessions or address change; wrong/expired: 400 `invalid_confirmation_code`, field `code`. Every attempt counts against 5 per 15 min per user plus the per-IP limit (`AuthRateLimiter::assertAccountDeleteAllowed`, 429 `rate_limited`); nothing is deleted before the proof is valid, then the last-member guard (422 `last_member_of_club`) applies. Frontend: `DeleteAccountDialog`
- Account: `PATCH /api/auth/me` (`name`, prefs, last club/calendar, the latter also per membership), `POST /api/auth/change-password` (new tokens, other sessions end; password change and reset discard a waiting e-mail change), `POST|DELETE /api/auth/change-email` + `GET /api/auth/verify-new-email` (link to the new address, table `email_change`, ends all sessions), SSO `POST /api/auth/oauth/{provider}/link-start` → ticket → provider → `/profile?link_proof=` → `POST /api/auth/oauth/{provider}/link-complete` with the JWT (only the user who started it can complete it: link-CSRF protection) / `DELETE /api/auth/oauth/{provider}` (last sign-in method stays, row lock). Details: `docs/api/openapi.yaml`
- Console: `app:user:verify <email>`, `app:user:reset-link <email>` (prints the URL only), cron `app:prune-password-resets`, `app:prune-unverified-users`, `app:prune-refresh-tokens`, `app:legal:sync` (legal documents), `app:prune-club-invitations` (accepted/declined invitations answered, and open ones expired, more than 30 days ago)

## Club invitations

Nobody is added to a club without consent (audit M8; the old `POST /api/clubs/{id}/members` is gone, `GET` list and `DELETE /members/{userId}` stay). Only admins may manage invitations. `App\Service\ClubInvitationService`, entity `ClubInvitation` (table `club_invitation`, UUID v7; normalized lower-case address, `invitedBy` (SET NULL on account deletion), `role` viewer|editor|admin (default editor), `status` pending|accepted|declined, `createdAt`, `expiresAt` = +7 days, `resolvedAt`; only the SHA-256 hash of the random token is stored like `password_reset`), mail `club_invitation.mjml` (club name + inviter name only, link `{FRONTEND_URL}/invitations?token=…` and a `/signup` hint, sent after the response via `DeferredMailer`; identical for registered and unregistered addresses).

```
POST   /api/clubs/:id/invitations {email, role?}    # 204 for EVERY well-formed address (unknown, registered, member, already invited): no enumeration; role defaults to editor
GET    /api/clubs/:id/invitations                   # pending + expired (computed `status`), accepted/declined are not listed; includes role
POST   /api/clubs/:id/invitations/:invId/resend     # only after expiry (else 422 invitation_not_expired): new token, +7 days, new mail; 204
DELETE /api/clubs/:id/invitations/:invId            # revoke pending/expired; 200 {ok: true}
GET    /api/invitations                             # own open, non-expired ones by VERIFIED e-mail: [{id, clubName, invitedByName, expiresAt, role}]
POST   /api/invitations/:id/accept | /decline       # by id from the list; accept -> 200 {id, name, timezone} of the club, decline -> 204
POST   /api/invitations/accept | /decline {token}   # by the token of the mail link (SPA calls it after sign-in)
```

Rules: an existing member's address is ignored silently (nothing stored, no mail); an open invitation for club+address is kept (idempotent, no second mail), an expired one is renewed like a re-send. The token only identifies an invitation: the signed-in user's VERIFIED address must equal the invited one, every other case (wrong token/id, other user, unverified user, answered) is the same 404 `invitation_not_found`; an own but expired one is 422 `invitation_expired`. Accepting runs in a transaction under the club row lock (`removeMember` style), respects `membersPerClub` and does not duplicate an existing membership. Nothing is auto-accepted: after registration/SSO the invitee finds invitations via `GET /api/invitations`. Limits: 20 invitations/re-sends per user and 50 per club and day (`AuthRateLimiter::assertInvitationAllowed`, 429 `rate_limited`), at most 5 invitation mails per address and day (silently no mail, same answer), `Quota::PENDING_INVITATIONS_PER_CLUB` = 200 open invitations (422 `quota_exceeded`). Users without any club are fully supported. Details: `docs/api/openapi.yaml`.

## Legal documents and consent

Imprint, privacy policy and terms of use are operator-provided Markdown files `imprint.md`, `privacy.md`, `terms.md` in `backend/legal/` (env `LEGAL_DOCUMENTS_PATH`, default `%kernel.project_dir%/legal`; real `*.md` are gitignored/dockerignored, `*.md.example` and `README.md` are shipped; the container expects a mount at `/var/www/html/legal`). `App\Service\LegalDocumentService` syncs them into `legal_document` (UUID v7): on cache clear/warmup (`LegalDocumentCacheWarmer`) and with `app:legal:sync` (called by `docker/entrypoint.sh`, non-fatal, missing documents are logged as warnings). A version is identified by its content hash: changed content = new document row with a new UUID, the old one stays for the consent history; a type whose file is missing is retired. Rendered HTML is produced by the backend.

```
GET  /api/legal                         # overview of the current documents per type (public)
GET  /api/legal/:type                   # current document (imprint|privacy|terms), 404 legal_document_not_found
GET  /api/legal/documents/:id           # one specific (older) version
GET  /api/auth/consents                 # own consent history (with IP and user agent)
POST /api/auth/consents {documentIds}   # consent to the current documents (old versions: 422 consent_outdated)
```

`POST /api/auth/register` takes `acceptedDocuments` (ids of the current privacy + terms documents; stale/other: 422 `consent_outdated`). Consent gate (`ConsentGateListener`): a signed-in user without consent to the current privacy/terms gets 403 `consent_required` (+ `documents`) on every `/api/*` route except an allow-list (`GET|DELETE /auth/me`, `/auth/consents`, logout, token, providers, delete-account code, health, `/api/legal*`, `/api/feed/*`); without any provided consent document nobody is gated. `GET|PATCH /api/auth/me` return `pendingConsents` and `consentRequired` (same builder `AuthService::getMe`). Frontend: `lib/legal`, `components/legal/` (`LegalLinks` in the footer of `AuthLayout` and `PublicShell`, `LegalDocumentView`, `ConsentCheckboxes`), `/imprint` `/privacy` `/terms` as routed modal (with background state) or standalone `LegalPage`, consent checkboxes in the signup form, `ConsentPage` as gate in `ProtectedRoute` (besides accepting and signing out it offers the consent history in a modal and account deletion via `DeleteAccountDialog`), `LegalSection` (consent history) in the profile. While a session runs, a document update only shows the dismissible `ConsentChangeBanner` (`pendingConsents` without `consentRequired`; `ProtectedRoute` places it, the dialog accepts via `POST /api/auth/consents`); the gate follows at the next sign-in. Details: `docs/api/openapi.yaml`, `backend/legal/README.md`.

## API Errors

Every error is an RFC 7807 body (`App\Http\ProblemResponse`) with a stable `code` (and `field` for input errors) via `App\Exception\ApiProblemException`, e.g. `validation_failed`, `invalid_request`, `unknown_reference`, `duplicate_name`, `too_many_events`, `quota_exceeded`, `email_taken`, `invalid_credentials`, `email_not_verified` (login 403), `invalid_refresh_token`, `invalid_passkey`, `member_not_found`, `invitation_not_found`, `invitation_expired`, `invitation_not_expired`, `ics_fetch_failed`, `rate_limited`, `forbidden`, `invalid_role`, `last_admin`, `consent_required` (403, `documents`), `consent_outdated` (422, `documents`), `legal_document_not_found` (404). A 401 of the access token is always `missing_token` / `invalid_token` / `token_expired` (`App\Security\JwtProblemListener`; also replaces the JWT bundle's bodies; the sign-in routes answer 401 `invalid_credentials` / `invalid_refresh_token` / `invalid_passkey`), every 401 with `WWW-Authenticate: Bearer`; club, calendar and geocoding routes answer 401 without a token before any id is looked up (`access_control`), 403 only to signed-in non-members. Status rule: malformed input (typed `Input` checks, incl. time zones and coordinates) is 400, DTO constraint violations and state conflicts 422; every 400 has a code (framework 400s `invalid_request`, array query parameters `validation_failed` + `field`). The frontend matches `ApiError.code`, never `detail`. Full list: `ErrorCode` in `docs/api/openapi.yaml`.

## Limits and Quotas (audit M7)

All quotas live in `App\Service\Quota` (`LIMITS`, generous on purpose; checked by a count before the write via `Quota::assertRoom()`); exceeding one is 422 `quota_exceeded` with the members `resource` and `limit`: 50 clubs per user, 100 calendars per club (create + duplicate), 500 members per club, 20000 events per calendar (create, from-template, series create/rule change, import), 2000 locations per club (import included), 500 target groups per club, 50 feeds per club, 500 each of properties/features per calendar, 20 holiday calendars per calendar. Per-request caps: 5000 events/locations per import and 5000 ids per bulk (413), 366 events per series and 366 `dates` of `from-template` (422 `too_many_events`), 500 distinct ids per id-list field (`Input::MAX_IDS`, 400), holiday ICS 1 MB / 5000 events (`HolidayCalendarService`). `GET …/events`: at most 1830 days between `from` and `to` (400 on `to`), `limit` (default and max 5000) and `offset`, `X-Total-Count` header, body stays a plain list (the list page without `from`/`to` shows at most the first 5000). A new create route must call `Quota::assertRoom()`; document it in `docs/api/openapi.yaml` ("Quotas and input limits"). The frontend shows one toast for every `quota_exceeded` (`errorFrom` in `frontend/src/lib/api.ts`, `common.quotaExceeded`).

## Event Import, Export, Bulk, Series

```
POST /api/calendars/:id/events/import/preview   # {events, locations?} → status per entry (new|duplicate|invalid), writes nothing; new locations reference club-scoped locations
POST /api/calendars/:id/events/import           # {events, locations?: [{tempId, name, …}], skipDuplicates?} → one transaction; locations scoped to club
GET  /api/calendars/:id/events.ics?from&to&includeDrafts&targetGroupIds[]   # member ICS download (target groups club-scoped)
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
GET /api/feed/:feedId/events[?from=YYYY-MM-DD&to=YYYY-MM-DD]   # web view: header (club, feed name, zone, visibility, eventCount), events and holidays of all selected calendars merged, holidays de-duplicated by uid
GET /api/feed/:feedId/events/:eventId                          # one published event (secret checked first)
```

Feed ICS contains events only (no holidays). Feed web view merges published events and holiday events of all selected non-archived calendars in the feed's timezone; if all selected calendars are archived, returns 404. Feed management responses (`/api/clubs/:clubId/feeds…`) omit `sharedSecret` unless `?includeSecret=1|true` is sent (the frontend sends it where it shows or copies the feed address). Deleting a calendar deletes feeds whose only calendar it is; other feeds simply lose that calendar from their selection.

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
