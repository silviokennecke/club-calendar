# Club Calendar — Agent Guide

Project overview, stack, scripts and working rules: `CLAUDE.md`. Frontend conventions (Vite SPA, design system,
routed modals, E2E): `frontend/AGENTS.md`. Redesign final state and open backend gaps: `docs/redesign/`.

## Backend Module Structure

The backend (`backend/`) uses Symfony 8.1 with attribute routing. Controllers are thin; business logic lives in Services.

| Module | URL prefix | Controller | Service |
|--------|-----------|------------|---------|
| Auth | `/api/auth` | `AuthController` | `AuthService`, `TokenService` |
| WebAuthn | `/api/auth/webauthn` | `WebAuthnController` | `WebAuthnService` |
| OAuth | `/api/auth/oauth` | `OAuthController` | (uses `AuthService`) |
| Clubs | `/api/clubs` | `ClubController` | `ClubService` |
| Calendars | `/api/clubs/{clubId}/calendars` | `CalendarController` | `CalendarService` |
| Events | `/api/calendars/{calendarId}/events` | `EventController` | `EventService` |
| Event Templates | `/api/calendars/{calendarId}/templates` | `EventTemplateController` | `EventTemplateService` |
| Properties | `/api/calendars/{calendarId}/properties` | `PropertyController` | `PropertyService` |
| Features | `/api/calendars/{calendarId}/features` | `FeatureController` | `FeatureService` |
| Target Groups | `/api/calendars/{calendarId}/target-groups` | `TargetGroupController` | `TargetGroupService` |
| Locations | `/api/calendars/{calendarId}/locations` | `LocationController` | `LocationService` |
| Feeds | `/api/calendars/{calendarId}/feeds` (incl. single GET `…/{feedId}`) | `FeedController` | `FeedService` |
| Public Feed | `/api/feed/{id}/events` (`?from&to`, header + holidays), `/api/feed/{id}/events/{eventId}`, `/api/feed/{id}/ics` | `PublicFeedController` | `PublicFeedService`, `IcsService` |
| Holiday Calendars | `/api/calendars/{calendarId}/holiday-calendars`, `…/holiday-events` | `HolidayCalendarController`, `HolidayEventController` | `HolidayCalendarService` |
| Mapbox Proxy | `/api/mapbox` | `MapboxController` | `Map\MapboxProxyService` |
| Map images / geocoding | `/api/map` | `MapController` | `Map\*` (cached, rate-limited providers) |
| Health | `/api/health` | `HealthController` | — |

## Common Infrastructure

| File | Purpose |
|------|---------|
| `src/Security/CurrentUserResolver.php` | Resolves authenticated `User` entity from JWT token |
| `src/Security/CalendarMemberVoter.php` | Checks user is a member of the calendar's club (`CALENDAR_MEMBER`) |
| `src/Security/ClubMemberVoter.php` | Checks user is a club member (`CLUB_MEMBER`) |
| `src/Security/ArchivedCalendarVoter.php` | Blocks writes to archived calendars (`NOT_ARCHIVED`) |
| `src/EventListener/ExceptionListener.php` | Converts all exceptions to RFC 7807 `application/problem+json` |
| `src/Controller/AbstractApiController.php` | Base controller with `validateDto()` and `decodeJson()` helpers |
| `src/Service/TokenService.php` | Creates JWT access tokens (lexik) and HMAC refresh tokens (claims `uid`, `tv` = `user.token_version`) |
| `src/Security/SessionVersionListener.php` | Rejects JWTs whose `tv`/`uid` no longer match the user (sessions ended after credential resets) |
| `src/Security/SignedTokenService.php`, `NonceStore.php` | Signed, purpose-bound, single-use tokens (passkey challenges, OAuth `state`; table `auth_nonce`) |
| `src/Service/CalendarReferences.php` | Resolves location/template/property/feature/target-group IDs within one calendar (unknown or foreign → 422) |
| `src/Service/LinkCollectionSync.php` | Syncs join-table collections by diff (deduplicated IDs, no identity collisions) |
| `src/Service/Input.php` | Typed input validation helpers (400 with field name) |
| `src/Service/UsageCounts.php` | Counters for lists and delete dialogs (clubs, calendars, usage of properties/features/target groups/locations, events per template): one grouped query per counter, never one per row |
| `src/Service/UniqueNames.php` | Names of properties/features/target groups unique per calendar (trim, case-insensitive, compared in PHP; no unique index, old duplicates stay) |
| `src/Exception/ApiProblemException.php` | HTTP error with a stable `code` (+ optional `field`) in the RFC 7807 body, e.g. 422 `duplicate_name` |
| `config/packages/security.yaml` | Stateless JWT firewall; public routes allowlist |
| `migrations/` | Doctrine migrations (initial schema `Version20260625000000`, all tables in snake_case; then `Version20261004120000` `auth_nonce`, `Version20261004130000` `user.token_version`, latest `Version20261009120000` nullable template times) |

## Security Pattern

Controllers use `$this->denyAccessUnlessGranted(VoterConstant::ATTRIBUTE, $entity)` to enforce authorization.

```php
// Example: calendar endpoint
$calendar = $this->em->getRepository(Calendar::class)->find($calendarId);
$this->denyAccessUnlessGranted(CalendarMemberVoter::CALENDAR_MEMBER, $calendar);
$this->denyAccessUnlessGranted(ArchivedCalendarVoter::NOT_ARCHIVED, $calendar); // only on writes
```

## Auth Flow

- **Access token**: short-lived JWT (15 min), `Authorization: Bearer <token>` header
- **Refresh token**: HMAC-SHA256 signed JWT (7 days), client-managed in `sessionStorage`
- **Refresh grant**: `POST /api/auth/token` with `application/x-www-form-urlencoded` body
- **No auth cookies** — the backend sets no session/auth cookies (only the short-lived OAuth `oauth_state_nonce` cookie that binds the SSO `state` to the browser)
- **Passkeys** — verified with `web-auth/webauthn-lib` (`WebAuthnService`), see `CLAUDE.md` (Auth) and `docs/redesign/BACKEND-GAPS.md`

## Entity Conventions

- PHP camelCase properties → snake_case DB columns (UnderscoreNamingStrategy)
- All relations use cascade delete (carried over from the original Prisma schema)
- Join table entities (e.g. `EventProperty`, `ClubUser`) use composite `#[ORM\Id]`
- `FeedVisibility` is a PHP 8.1 backed enum mapped via `enumType`
- **Entity IDs are always UUIDs** — use `#[ORM\Column(length: 36)]` with `Uuid::v7()->toRfc4122()` assigned in the constructor. Never use `#[ORM\GeneratedValue]` or `int` IDs. `getId()` returns `string`.
- **Frontend types for entity IDs are always `string`** — never `number`

## Testing

Tests are in `tests/Controller/` using `Symfony\Bundle\FrameworkBundle\Test\WebTestCase`.
`tests/Helper/DatabaseResetter::reset($em)` truncates all tables before each test class.
`tests/Helper/TestHelper` provides factory helpers: `createUser`, `createClub`, `createCalendar`, `createEvent`, `createTemplate`.
`tests/Helper/QueryCounter` (DBAL middleware, registered only in `config/services_test.yaml`) counts SQL statements:
list endpoints are tested to run the same number of queries for more rows (no N+1, see `CountersTest`).
The KernelBrowser reboots the kernel between requests: re-fetch entities (`$em->find(...)`) before changing them
after a request.

Run: `cd backend && composer test` (requires MySQL test DB on port 3360)

## Calendar Archive & Duplicate

- `Calendar::archivedAt` — null = active; set = archived and read-only
- `POST /api/clubs/{clubId}/calendars/{calendarId}/archive` — sets `archivedAt`
- `POST /api/clubs/{clubId}/calendars/{calendarId}/unarchive` — clears `archivedAt`
- `POST /api/clubs/{clubId}/calendars/{calendarId}/duplicate` (201) — deep-copies calendar + properties/features/target-groups/locations/templates/feeds (new UUIDs for feed secrets); events not copied; optional body `{name}` (default "Copy of …", the frontend sends the localized name)
- Calendar responses carry `eventCount`, `templateCount`, `feedCount`; club responses `calendarCount`, `archivedCalendarCount`, `memberCount` (single club also `eventCount`, `feedCount`)
- Event templates: `timezone`, `timeBegin`, `timeEnd` are optional (times only as a pair); without times in the template and in the request, `from-template` creates all-day events (`docs/redesign/BACKEND-GAPS.md`, "Umgesetzt (Paket 1)")
- Archived calendar public feeds → 404; nested write endpoints → 403 (via `ArchivedCalendarVoter`)
