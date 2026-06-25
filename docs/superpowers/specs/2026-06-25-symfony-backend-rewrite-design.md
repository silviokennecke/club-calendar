# Symfony Backend Rewrite — Design Spec

**Date:** 2026-06-25
**Status:** Approved
**Scope:** Replace the NestJS/TypeScript backend with a Symfony 8.1/PHP 8.4 backend. Adjust the Next.js frontend for the new OAuth2-compliant token flow.

---

## 1. Motivation

- The broader infrastructure runs PHP 8.4; most colleagues are more proficient in Symfony than Node.js.
- Traditional hosters support PHP more easily than Node.js runtimes.
- The NestJS backend is functionally complete — this is a technology migration, not a feature change.

---

## 2. Constraints

- The frontend (Next.js 15) stays untouched except for the auth token handling changes described in Section 6.
- The public API surface (URL paths, HTTP methods, JSON response shapes) stays equivalent. Minor deviations from the NestJS version are acceptable when they align with Symfony best practices (e.g. RFC 7807 error format).
- Full feature parity: auth (password, OAuth SSO, WebAuthn/passkeys), all CRUD domains, ICS feed, Mapbox proxy.
- Production-ready quality: integration tests against real MySQL, Doctrine migrations as the single source of truth.

---

## 3. Stack

| Concern | Choice |
|---|---|
| Language / runtime | PHP 8.4 |
| Framework | Symfony 8.1 |
| ORM | Doctrine ORM (attribute mapping) |
| DB migrations | `doctrine/migrations` |
| JWT | `lexik/jwt-authentication-bundle` |
| OAuth SSO | `knpuniversity/oauth2-client-bundle` + league providers |
| WebAuthn | `web-auth/webauthn-lib` |
| ICS generation | `eluceo/ical` |
| Validation | `symfony/validator` (DTO constraints) |
| Serialization | `symfony/serializer` |
| Tests | PHPUnit 11 + `symfony/test-pack` |
| Dev server | `symfony/cli` (`symfony serve --port=3001`) |

---

## 4. Repository Layout

The `backend/` directory is replaced entirely on a dedicated git branch. The NestJS version remains intact on `main` until the branch is merged.

```
backend/
├── composer.json
├── composer.lock
├── .env                      # local overrides (gitignored)
├── .env.example
├── config/
│   ├── packages/
│   │   ├── doctrine.yaml
│   │   ├── doctrine_migrations.yaml
│   │   ├── lexik_jwt_authentication.yaml
│   │   ├── knpu_oauth2_client.yaml
│   │   ├── security.yaml
│   │   └── framework.yaml
│   ├── routes/
│   │   └── api.yaml
│   └── services.yaml
├── migrations/               # Doctrine migrations (replaces prisma/migrations/)
├── public/
│   └── index.php             # Symfony front controller
├── src/
│   ├── Controller/
│   │   ├── AuthController.php
│   │   ├── WebAuthnController.php
│   │   ├── OAuthController.php
│   │   ├── ClubController.php
│   │   ├── CalendarController.php
│   │   ├── EventController.php
│   │   ├── EventTemplateController.php
│   │   ├── FeedController.php
│   │   ├── LocationController.php
│   │   ├── PropertyController.php
│   │   ├── FeatureController.php
│   │   ├── TargetGroupController.php
│   │   ├── MapboxController.php
│   │   └── PublicFeedController.php
│   ├── Dto/                  # Request DTOs with validator constraints
│   ├── Entity/               # Doctrine entities
│   ├── Enum/
│   │   └── FeedVisibility.php
│   ├── Repository/           # Doctrine repositories
│   ├── Security/
│   │   ├── JwtRefreshAuthenticator.php
│   │   ├── CalendarMemberVoter.php
│   │   ├── ClubMemberVoter.php
│   │   └── ArchivedCalendarVoter.php
│   ├── Service/
│   │   ├── AuthService.php
│   │   ├── WebAuthnService.php
│   │   ├── OAuthService.php
│   │   ├── IcsService.php
│   │   └── (one service per domain module)
│   └── EventListener/
│       └── ExceptionListener.php  # RFC 7807 error normalizer
└── tests/
    ├── Controller/
    │   ├── AuthTest.php
    │   ├── CalendarTest.php
    │   ├── ClubTest.php
    │   ├── EventTest.php
    │   ├── PublicTest.php
    │   └── ResourcesTest.php
    └── Helper/
        └── DatabaseResetter.php
```

---

## 5. Database & Migrations

### Naming convention

Doctrine's `UnderscoreNamingStrategy` is enabled globally. PHP class properties use camelCase; generated SQL uses snake_case:

| PHP property | DB column |
|---|---|
| `$calendarId` | `calendar_id` |
| `$dateFormat` | `date_format` |
| `$createdAt` | `created_at` |
| Entity `CalendarFeed` | Table `calendar_feed` |

### Schema

Doctrine entities map 1-to-1 to the existing Prisma schema models: `User`, `Club`, `ClubUser`, `Calendar`, `CalendarFeed`, `CalendarFeedTargetGroup`, `Property`, `Feature`, `TargetGroup`, `Location`, `EventTemplate`, `Event`, `Passkey`, `OAuthAccount` (plus the join-table entities for many-to-many relations).

The `FeedVisibility` enum becomes a PHP 8.1 backed enum:

```php
enum FeedVisibility: string {
    case PUBLIC = 'PUBLIC';
    case PRIVATE = 'PRIVATE';
}
```

Mapped with Doctrine's native enum type support (`enumType: FeedVisibility::class`).

### Migration strategy

- Prisma migrations are discarded.
- A single initial Doctrine migration recreates the complete schema in snake_case.
- **Important:** the existing database must be dropped and recreated at switchover, as column names change from camelCase (Prisma default) to snake_case.
- Future schema changes use `doctrine:migrations:diff` + review + `doctrine:migrations:migrate`.

---

## 6. Authentication & Token Flow (OAuth2-compliant)

### Password login / registration

```
POST /api/auth/register   { name, email, password }
POST /api/auth/login      { email, password }

Response: {
  access_token:  string,   // short-lived JWT (15 min)
  token_type:    "Bearer",
  expires_in:    900,
  refresh_token: string    // long-lived opaque token (7 days)
}
```

No cookies are set by the backend. The frontend owns both tokens.

### Token refresh (standard OAuth2 refresh grant)

```
POST /api/auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<token>

Response: {
  access_token: string,
  token_type:   "Bearer",
  expires_in:   900,
  refresh_token: string   // rotated on each use
}
```

The `/api/auth/refresh` cookie endpoint from the NestJS version is removed.

### OAuth SSO (Google, Microsoft, Apple)

- `GET /api/auth/oauth/{provider}` — redirects to provider; state + PKCE verifier stored in short-lived signed cookie
- `GET|POST /api/auth/oauth/{provider}/callback` — exchanges code, creates/links user, redirects to `FRONTEND_URL/auth/callback?token=<accessToken>&refresh_token=<refreshToken>`
- Frontend reads both tokens from the redirect URL query params

### WebAuthn / Passkeys

- `GET  /api/auth/webauthn/register/options` — returns registration options + signed challenge token
- `POST /api/auth/webauthn/register/verify` — verifies credential, links to user
- `GET  /api/auth/webauthn/authenticate/options` — returns authentication options + challenge token
- `POST /api/auth/webauthn/authenticate/verify` — verifies assertion, returns `{ access_token, token_type, expires_in, refresh_token }`
- `DELETE /api/auth/webauthn/{id}` — removes a passkey

Challenge signed as short-lived JWT (same approach as NestJS implementation).

### Authorization

NestJS guards become Symfony security voters:

| NestJS guard | Symfony equivalent |
|---|---|
| `JwtAuthGuard` | `lexik/jwt-authentication-bundle` firewall |
| `CalendarMemberGuard` | `CalendarMemberVoter` |
| `ClubMemberGuard` | `ClubMemberVoter` |
| `ArchivedCalendarGuard` | `ArchivedCalendarVoter` |

Controllers call `$this->denyAccessUnlessGranted('CALENDAR_MEMBER', $calendar)` etc.

---

## 7. Domain Modules

All authenticated resource endpoints require a valid Bearer access token. Controllers are thin; business logic lives in services.

| Module | Endpoints |
|---|---|
| User (`/api/auth/me`) | `GET`, `PATCH`, `DELETE` |
| Auth providers | `GET /api/auth/providers` |
| Clubs | `GET/POST /api/clubs`, `GET/PATCH/DELETE /api/clubs/{id}` |
| Calendars | `GET/POST /api/clubs/{clubId}/calendars`, `GET/PATCH/DELETE .../calendars/{id}` |
| Events | Full CRUD + `POST .../events/from-template`, `POST .../events/import` (max 500) |
| EventTemplates | Full CRUD under `/api/calendars/{calendarId}/templates` |
| Feeds | Full CRUD under `.../feeds`, `POST .../feeds/{id}/regenerate-secret` |
| Locations | Full CRUD |
| Properties | Full CRUD |
| Features | Full CRUD |
| TargetGroups | Full CRUD |
| Public feed | `GET /api/feed/{feedId}/events`, `GET /api/feed/{feedId}/ics` |
| Mapbox proxy | `GET /api/mapbox/*` — proxies to Mapbox API, injects server-side token |

### Input validation

NestJS Zod schemas become Symfony DTOs with validator constraints (`#[Assert\NotBlank]`, `#[Assert\Email]`, `#[Assert\Length]`, `#[Assert\Regex]`, etc.). Invalid input returns HTTP 422 with RFC 7807 body.

### Error format

All error responses use RFC 7807 (`application/problem+json`):

```json
{
  "type":   "https://tools.ietf.org/html/rfc2616#section-10",
  "title":  "Unprocessable Entity",
  "status": 422,
  "detail": "email: This value is not a valid email address."
}
```

---

## 8. Frontend Auth Changes

File locations in `frontend/src/`:

- **`lib/auth.ts`** (or equivalent token store) — store both `access_token` and `refresh_token` in `sessionStorage` instead of only the access token. Remove any cookie-based refresh logic.
- **`lib/api.ts`** (or fetch/axios client) — add a 401 interceptor: on 401, call `POST /api/auth/token` with `grant_type=refresh_token`, update stored tokens, retry original request. On refresh failure, clear tokens and redirect to `/login`.
- **OAuth callback page** (`/auth/callback`) — read `refresh_token` from URL query params alongside `token` (access token) and store both.
- **Logout** — clear both tokens from `sessionStorage`.
- **E2E tests** — update `auth.spec.ts` helpers to seed/clear both tokens.

---

## 9. Testing

- **Framework:** PHPUnit 11 + `symfony/test-pack`
- **Test database:** MySQL on port 3360 (`club_calendar_test`), same Docker service as now
- **Setup:** `DatabaseResetter` helper runs before each test class — truncates all tables and applies fixtures via `DoctrineFixturesBundle`
- **Test files** in `tests/Controller/` mirror the current Vitest files: `AuthTest`, `ClubTest`, `CalendarTest`, `EventTest`, `PublicTest`, `ResourcesTest`
- **Root `npm test`** updated: runs `composer test -d backend` then Vitest for the frontend

---

## 10. Dev Setup

```bash
# 1. Start databases (unchanged)
docker compose up mysql mysql_test -d

# 2. Install PHP dependencies
cd backend && composer install

# 3. Run migrations
php bin/console doctrine:migrations:migrate

# 4. Load seed fixtures
php bin/console doctrine:fixtures:load

# 5. Start backend (port 3001)
symfony serve --port=3001

# Frontend (unchanged, port 3000)
npm run dev:frontend
```

`CLAUDE.md` and `AGENTS.md` are updated to reflect the Symfony stack, Composer commands, and PHPUnit conventions.

---

## 11. Out of Scope

- FrankenPHP deployment (can be added later independently)
- API versioning
- Admin UI or super-admin roles
- Any new features beyond the existing NestJS feature set
