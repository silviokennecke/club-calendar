# Club Calendar — Agent Guide

Project overview, stack, scripts and working rules: `CLAUDE.md`. Frontend conventions (Vite SPA, design system,
routed modals, E2E): `frontend/AGENTS.md`. Redesign final state and open backend gaps: `docs/redesign/`.

## Backend Module Structure

The backend (`backend/`) uses Symfony 8.1 with attribute routing. Controllers are thin; business logic lives in Services.
API reference: `docs/api/openapi.yaml` (OpenAPI 3.1, hand-written; `tests/Unit/OpenApiSpecTest.php` checks it against
the router, so a new or changed route needs a matching operation there).

| Module | URL prefix | Controller | Service |
|--------|-----------|------------|---------|
| Auth | `/api/auth` (incl. `forgot-password`, `reset-password`, `change-password`, `change-email`, `verify-new-email`) | `AuthController` | `AuthService`, `TokenService`, `PasswordResetService`, `AccountService`, `AccountMailer` |
| WebAuthn | `/api/auth/webauthn` | `WebAuthnController` | `WebAuthnService` |
| OAuth | `/api/auth/oauth` (sign-in; link `/{provider}/link-start` → `/{provider}/link?ticket=` → callback → `/profile?link_proof=` → `/{provider}/link-complete` (JWT); unlink `DELETE /{provider}`) | `OAuthController` | `AuthService`, `AccountService` |
| Clubs | `/api/clubs` | `ClubController` | `ClubService` |
| Calendars | `/api/clubs/{clubId}/calendars` | `CalendarController` | `CalendarService` |
| Events | `/api/calendars/{calendarId}/events` (incl. `…/import/preview`, `…/import`, `…/bulk`, `…/series/preview`, `…/series`, PATCH/DELETE with `scope=this\|all`, export `/api/calendars/{calendarId}/events.ics`) | `EventController` | `EventService`, `EventSeriesService`, `EventImportService`, `EventExportService` |
| Event Series | `/api/calendars/{calendarId}/event-series/{seriesId}` (GET rule + `eventCount`; `POST …/preview-update {rule}`, `PATCH {rule}` change the rule for future events) | `EventSeriesController` | `EventSeriesService`, `SeriesRule` |
| Event Templates | `/api/calendars/{calendarId}/templates` | `EventTemplateController` | `EventTemplateService` |
| Properties | `/api/calendars/{calendarId}/properties` | `PropertyController` | `PropertyService` |
| Features | `/api/calendars/{calendarId}/features` | `FeatureController` | `FeatureService` |
| Target Groups | `/api/calendars/{calendarId}/target-groups` | `TargetGroupController` | `TargetGroupService` |
| Locations | `/api/calendars/{calendarId}/locations` | `LocationController` | `LocationService` |
| Feeds | `/api/calendars/{calendarId}/feeds` (incl. single GET `…/{feedId}`) | `FeedController` | `FeedService` |
| Public Feed | `/api/feed/{id}/events` (`?from&to`, header + holidays), `/api/feed/{id}/events/{eventId}`, `/api/feed/{id}/ics` | `PublicFeedController` | `PublicFeedService`, `IcsService` |
| Holiday Calendars | `/api/calendars/{calendarId}/holiday-calendars`, `…/holiday-events` | `HolidayCalendarController`, `HolidayEventController` | `HolidayCalendarService` |
| Mapbox Proxy | `/api/mapbox` (GET only) | `MapboxController` | `Map\MapboxProxyService` |
| Map images / geocoding | `/api/map` | `MapController` | `Map\*` (cached, rate-limited providers); without `MAPBOX_TOKEN` (`Map\MapAvailability`) images answer 503 with `backend/assets/map-unavailable.png` (after the 404 checks), geocoding and the Mapbox proxy 503 `map_unavailable` |
| Health | `/api/health` | `HealthController` | — |

## Common Infrastructure

| File | Purpose |
|------|---------|
| `src/Security/CurrentUserResolver.php` | Resolves authenticated `User` entity from JWT token |
| `src/Security/CalendarMemberVoter.php` | Checks user is a member of the calendar's club (`CALENDAR_MEMBER`) |
| `src/Security/ClubMemberVoter.php` | Checks user is a club member (`CLUB_MEMBER`) |
| `src/Security/ArchivedCalendarVoter.php` | Blocks writes to archived calendars (`NOT_ARCHIVED`) |
| `src/EventListener/ExceptionListener.php` | Converts all exceptions to RFC 7807 `application/problem+json` (`src/Http/ProblemResponse.php`); access denied without a signed-in user → 401 `missing_token`; every 400 gets a code (framework 400s `invalid_request`, array query parameters `validation_failed` + `field`) |
| `src/Security/JwtProblemListener.php` | 401 problems of the JWT bundle: `missing_token`, `invalid_token`, `token_expired` (`WWW-Authenticate: Bearer`) |
| `src/EventListener/FeedResponseHeadersListener.php` | `Referrer-Policy: no-referrer` + `X-Robots-Tag: noindex` on `/api/feed/*`, except successful responses of an indexable feed (`robotsTag()` reads the request attribute `feed_indexable` set by `PublicFeedService` after the access checks; missing → noindex) |
| `src/Controller/AbstractApiController.php` | Base controller with `validateDto()` and `decodeJson()` helpers (no JSON object → 400 `invalid_request`) |
| `src/Service/TokenService.php` | Creates JWT access tokens (lexik) and HMAC refresh tokens (claims `uid`, `tv` = `user.token_version`) |
| `src/Security/SessionVersionListener.php` | Rejects JWTs whose `tv`/`uid` no longer match the user (sessions ended after credential resets) |
| `src/Security/SignedTokenService.php`, `NonceStore.php` | Signed, purpose-bound, single-use tokens (passkey challenges, OAuth `state`, SSO link ticket/state/proof; table `auth_nonce`) |
| `src/Service/PasswordResetService.php` | Forgot / reset password: hashed one-time tokens (table `password_reset`, 60 min), single conditional UPDATE against races, ends all sessions |
| `src/Service/AccountService.php` | Change password (new tokens), e-mail change with confirmation link (table `email_change`, no oracle), unlink SSO (last sign-in method stays) |
| `src/Service/DeferredMailer.php`, `AccountMailer.php` | Mails (and `defer()`red work such as the forgot-password lookup and token) after the response (`kernel.terminate`, no timing oracle; transport errors are logged, never raised); links only from `FRONTEND_URL` / `BACKEND_URL`; notices (password changed, e-mail change requested / done) carry no token and no link but `/forgot-password`, the new address masked (`maskEmail`) |
| `src/Validator/PasswordPolicy.php` | The one password policy (8–128 characters) for registration, reset and change |
| `src/Logging/RedactTokensProcessor.php` | Monolog processor: `token`/`ticket`/`secret`/… query values in log records → `[redacted]` |
| `src/Command/` | `app:prune-unverified-users`, `app:prune-password-resets` (cron), `app:user:verify <email>`, `app:user:reset-link <email>` (support / dev / E2E) |
| `src/Service/CalendarReferences.php` | Resolves location/template/property/feature/target-group IDs within one calendar (unknown or foreign → 422) |
| `src/Service/LinkCollectionSync.php` | Syncs join-table collections by diff (deduplicated IDs, no identity collisions) |
| `src/Service/Input.php` | Typed input validation helpers (400 `validation_failed` with `field`, also invalid time zones; 422 is reserved for DTO constraints and state conflicts); `optionalDate` / `assertDateRange` for `from`/`to` query parameters (strict `YYYY-MM-DD`, never `strtotime`) |
| `src/Service/EventImportService.php` | ICS import: preview (`new`/`duplicate`/`invalid` per entry, writes nothing) and atomic import (new places by `tempId`, `skipDuplicates`, unknown time zones → calendar zone + `warnings`, max. 5000 per request → 413 `too_many_events`) |
| `src/Service/EventExportService.php` | Member ICS download via `IcsService` (`from`/`to` overlap, `includeDrafts` as TENTATIVE, `targetGroupIds[]` of the calendar, safe `Content-Disposition`) |
| `src/Service/SeriesRule.php` | Series rule (weekly / biweekly / monthly n-th weekday, `until` or `count`, `skipHolidays`, `durationDays`): validation and the ONLY computation of series dates (calendar days in UTC), max. 366 events (422 `too_many_events`) |
| `src/Service/EventSeriesService.php` | Series preview (dates, skipped holidays of the calendar's holiday calendars) and atomic creation of series + events (template values like `from-template`); rule change (`previewUpdate` / `update`: future events only, today in the calendar's zone via `ClockInterface`, prototype = earliest future event, series row locked, max. 366 events afterwards, 409 `series_empty` / `series_changed`); scope `this`/`all` of PATCH/DELETE and the clean-up of empty series live in `EventService` |
| `src/Service/UsageCounts.php` | Counters for lists and delete dialogs (clubs, calendars, usage of properties/features/target groups/locations, events per template): one grouped query per counter, never one per row |
| `src/Service/UniqueNames.php` | Names of properties/features/target groups unique per calendar (trim, case-insensitive, compared in PHP; no unique index, old duplicates stay) |
| `src/Exception/ApiProblemException.php` | HTTP error with a stable `code` (+ optional `field`) in the RFC 7807 body, e.g. 422 `duplicate_name`; code list: `ErrorCode` in `docs/api/openapi.yaml` |
| `config/services.yaml` | Parameters and env defaults: `APP_URL` drives `FRONTEND_URL`, `BACKEND_URL` and `WEBAUTHN_RP_ID`; optional `MAPBOX_TOKEN`, cache TTLs, `WEBAUTHN_USER_VERIFICATION` |
| `config/packages/security.yaml` | Stateless JWT firewall; `access_control` requires authentication for `/api/clubs*`, `/api/calendars*`, `/api/map/geocode/*` (401 before the entity lookup) |
| `migrations/` | Doctrine migrations (initial schema `Version20260625000000`, all tables in snake_case; then `Version20261004120000` `auth_nonce`, `Version20261004130000` `user.token_version`, `Version20261009120000` nullable template times, `Version20261010120000` `event.external_uid`, `Version20261013120000` `password_reset`, `email_change`, `passkey.last_used_at`, `club_user.last_calendar_id`, latest `Version20261014120000` `event_series` + `event.series_id`) |

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
- **Passkeys** — verified with `web-auth/webauthn-lib` (`WebAuthnService`), see `CLAUDE.md` (Auth) and `docs/api/openapi.yaml`
- **Password reset / account changes / SSO linking** — see `CLAUDE.md` (Auth) and `docs/api/openapi.yaml`; `user.token_version` ends all sessions on reset, password change (the caller gets new tokens) and e-mail change

## Entity Conventions

- PHP camelCase properties → snake_case DB columns (UnderscoreNamingStrategy)
- All relations use cascade delete (carried over from the original Prisma schema)
- Join table entities (e.g. `EventProperty`, `ClubUser`) use composite `#[ORM\Id]`
- `FeedVisibility` is a PHP 8.1 backed enum mapped via `enumType` (VARCHAR column): `PUBLIC`, `CLUB` (default for new feeds), `PRIVATE`. `PUBLIC` and `CLUB` are reachable without the secret and differ only in indexing; `PRIVATE` requires the secret (`requiresSecret()`); switching from `PUBLIC`/`CLUB` to `PRIVATE` always generates a new secret (`FeedService::update()`). `CalendarFeed.searchable` (search engine opt-in) is only allowed for `PUBLIC` (`searchable: true` otherwise → 422 `validation_failed` field `searchable`; switching away from `PUBLIC` resets it); `isIndexable()` = `PUBLIC && searchable`. Feed responses carry `searchable` and `indexable`, the public feed header `visibility` and `indexable`
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

Run: `cd backend && composer test` (requires a MySQL test DB on port 3360). `TEST_DATABASE_URL` falls back to `DATABASE_URL` in the `test` env; the tests wipe all tables, so never leave it unset next to a real database. There is no `mysql_test` compose service: automated runs use a throwaway container (`docker run -d --name cc-verify-mysql -p 3360:3306 …`, see `docs/redesign/E2E.md`) and set `TEST_DATABASE_URL` in the shell.

## Calendar Archive & Duplicate

- `Calendar::archivedAt` — null = active; set = archived and read-only
- `POST /api/clubs/{clubId}/calendars/{calendarId}/archive` — sets `archivedAt`
- `POST /api/clubs/{clubId}/calendars/{calendarId}/unarchive` — clears `archivedAt`
- `POST /api/clubs/{clubId}/calendars/{calendarId}/duplicate` (201) — deep-copies calendar + properties/features/target-groups/locations/templates/feeds (new feed secrets, same visibility, `searchable` reset to false); events (and therefore event series) not copied; optional body `{name}` (default "Copy of …", the frontend sends the localized name)
- Calendar responses carry `eventCount`, `templateCount`, `feedCount`; club responses `calendarCount`, `archivedCalendarCount`, `memberCount` (single club also `eventCount`, `feedCount`); `GET /api/clubs` also the caller's `lastCalendarId` per club (`club_user.last_calendar_id`, set by `PATCH /api/auth/me`)
- Event templates: `timezone`, `timeBegin`, `timeEnd` are optional (times only as a pair); without times in the template and in the request, `from-template` creates all-day events (`docs/api/openapi.yaml`)
- Archived calendar public feeds → 404; nested write endpoints → 403 (via `ArchivedCalendarVoter`)

## Event Series

- `EventSeries` (`event_series`: rule + optional template, FK calendar CASCADE, template SET NULL) and `Event.series` (`series_id`, SET NULL). The events are normal rows; the rule is re-evaluated only when it is changed.
- `POST …/event-series/{id}/preview-update {rule}` → `{toCreate, toDelete, kept, past, skippedHolidays}`; `PATCH …/event-series/{id} {rule}` → `{series, created, deleted, kept}`: future events (date ≥ today in the calendar's zone) on dates of the new rule stay, missing dates are created from the prototype (earliest future event), other future events are deleted; past events never change (`EventSeriesRuleChangeTest`).
- `POST …/events/series/preview {rule}` → `{dates, count, skippedHolidays, holidays}`; `POST …/events/series {rule, templateId?, event?, isDraft?}` → 201 `{series, events}` (one flush); lists carry `seriesId`, the single event GET also `series {id, rule, eventCount, …}`.
- `PATCH …/events/{id}` `scope: "all"` applies the sent fields to every event of the series except `date`/`dateEnd`/template (each event keeps its day); `this` (default) changes one event, which stays in the series. `DELETE …?scope=all` deletes the series with its events; a series without events is removed (also after bulk delete). Details: `docs/api/openapi.yaml`.
