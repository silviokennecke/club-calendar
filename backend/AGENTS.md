# Club Calendar — Backend Guide

Developer reference for `backend/` (Symfony 8.1, paths below are relative to it). Project overview, stack, scripts,
working rules and the detailed behaviour of auth, MCP, quotas, feeds etc.: `../CLAUDE.md`. Frontend conventions:
`../frontend/AGENTS.md`. E2E setup, operations and open backlog: `../docs/ops/`.

## Backend Module Structure

Attribute routing; controllers are thin, business logic lives in Services.
API reference: `../docs/api/openapi.yaml` (OpenAPI 3.1, hand-written; `tests/Unit/OpenApiSpecTest.php` checks it against
the router, so a new or changed route needs a matching operation there).

| Module | URL prefix | Controller | Service |
|--------|-----------|------------|---------|
| Auth | `/api/auth` (incl. `forgot-password`, `reset-password`, `change-password`, `change-email`, `verify-new-email`) | `AuthController` | `AuthService`, `TokenService`, `PasswordResetService`, `AccountService`, `AccountMailer` |
| WebAuthn | `/api/auth/webauthn` | `WebAuthnController` | `WebAuthnService` |
| OAuth | `/api/auth/oauth` (sign-in; link `/{provider}/link-start` → `/{provider}/link?ticket=` → callback → `/profile?link_proof=` → `/{provider}/link-complete` (JWT); unlink `DELETE /{provider}`) | `OAuthController` | `AuthService`, `AccountService` |
| Clubs | `/api/clubs` | `ClubController` | `ClubService` |
| Calendars | `/api/clubs/{clubId}/calendars` | `CalendarController` | `CalendarService` |
| Events | `/api/calendars/{calendarId}/events` (incl. `…/import/preview`, `…/import`, `…/bulk`, `…/series/preview`, `…/series`, PATCH/DELETE with `scope=this\|all`, exports `/api/calendars/{calendarId}/events.ics` and `events.pdf`) | `EventController` | `EventService`, `EventSeriesService`, `EventImportService`, `EventExportService`, `Pdf\PdfExportService` (see `../CLAUDE.md` "PDF Export") |
| Event Series | `/api/calendars/{calendarId}/event-series/{seriesId}` (GET rule + `eventCount`; `POST …/preview-update {rule}`, `PATCH {rule}` change the rule for future events) | `EventSeriesController` | `EventSeriesService`, `SeriesRule` |
| Event Templates | `/api/calendars/{calendarId}/templates` | `EventTemplateController` | `EventTemplateService` |
| Properties | `/api/calendars/{calendarId}/properties` | `PropertyController` | `PropertyService` |
| Features | `/api/calendars/{calendarId}/features` | `FeatureController` | `FeatureService` |
| Target Groups | `/api/clubs/{clubId}/target-groups` | `TargetGroupController` | `TargetGroupService` |
| Locations | `/api/clubs/{clubId}/locations` | `LocationController` | `LocationService` |
| Feeds | `/api/clubs/{clubId}/feeds` (incl. single GET `…/{feedId}`, `…/{feedId}/members[/by-email\|/bulk-delete\|/{userId}]`) | `FeedController` | `FeedService`, `FeedMemberService`, `FeedAccessPolicy` |
| Personal subscription | `/api/clubs/{clubId}/my-subscription` (GET, PUT, `…/rotate-secret`), `/api/clubs/{clubId}/my-feeds` | `MemberSubscriptionController` | `MemberSubscriptionService` (also called by `FeedClaimService`, `ClubService::removeMember`) |
| Personal subscription feed | `/api/feed/me/{subscriptionId}/ics` (public, secret), `/api/clubs/{clubId}/my-events[/{eventId}]` | `PersonalFeedController`, `MemberSubscriptionController` | `PersonalFeedService`, `PersonalSelection`, `PersonalIcsPlan` (reuse `PublicFeedService`, `IcsService`) |
| Public Feed | `/api/feed/{id}/events` (`?from&to`, header + holidays), `/api/feed/{id}/events/{eventId}`, `/api/feed/{id}/ics`; signed-in (not public): `POST /api/feed/{id}/claim`, `GET /api/feed/{id}/membership` | `PublicFeedController` | `PublicFeedService`, `IcsService`, `FeedClaimService` |
| Holiday Calendars | `/api/calendars/{calendarId}/holiday-calendars` (incl. `POST …/predefined`), `…/holiday-events`, `/api/holiday-sources/countries[/{iso}/subdivisions]` | `HolidayCalendarController`, `HolidayEventController`, `HolidaySourceController` | `HolidayCalendarService`, `OpenHolidaysClient` (openholidaysapi.org, lists cached 7 days in pool `holiday_sources`; `type` public\|school\|other, `source` ics\|openholidays; stale (> 3 months) predefined calendars are refreshed on `holiday-events` reads, once per hour per calendar; console `app:holidays:refresh [--all] [--calendar=id]`) |
| Mapbox Proxy | `/api/mapbox` (GET only) | `MapboxController` | `Map\MapboxProxyService` |
| Map images / geocoding | `/api/map` | `MapController` | `Map\*` (cached, rate-limited providers; geocoding is `geocoder.mapbox_de` (Bazinga Mapbox, `Geocoder\StatefulGeocoder`) wrapped directly by `CachingGeocoderDecorator` and `RateLimitedGeocoderDecorator`, both `Geocoder\Provider\Provider`, the controller maps `Geocoder\Location` to JSON); without `MAPBOX_TOKEN` (`Map\MapAvailability`) images answer 503 with `backend/assets/map-unavailable.png` (after the 404 checks), geocoding and the Mapbox proxy 503 `map_unavailable` |
| Club invitations | `/api/clubs/{clubId}/invitations` (admin), `/api/invitations` (invitee) | `ClubInvitationController`, `InvitationController` | `ClubInvitationService`, `ClubInvitationMailer` (see `../CLAUDE.md` "Club invitations") |
| Legal | `/api/legal` | `LegalController` | `LegalDocumentService`, `LegalConsentService`, `LegalPresenter` (see `../CLAUDE.md` "Legal documents and consent") |
| MCP grants | `/api/auth/mcp-grants` | `McpGrantController` | `OAuth\OAuthServerService` |
| OAuth server | `/api/oauth/{authorize,authorization-request,authorize/decision,register,token,revoke}`, `/.well-known/oauth-*` | `OAuth\OAuthAuthorizeController`, `OAuthTokenController`, `OAuthRegistrationController`, `OAuthMetadataController` | `OAuth\OAuthServerService`, `OAuthConsentService`, `RedirectUriPolicy` |
| MCP server | `/api/mcp` (bundle route, firewall `mcp`) | — | tools in `Mcp\Tool\`, `Mcp\McpContext`, `Mcp\Security\McpAuthenticator` (see `../CLAUDE.md` "MCP server and OAuth") |
| Health | `/api/health` | `HealthController` | — |

## Common Infrastructure

**Operator docs:** a change to environment variables, console commands, cron jobs, config files, rate limits, sign-in/SSO behaviour or legal documents also updates `../docs/admin/` (CLAUDE.md working rule 10): settings in `docs/admin/docs/configuration/reference.md`, operations (commands, cron, upgrades) in `docs/admin/docs/operations.md`, examples in `docs/admin/docs/examples/`. Write those pages for operators, without class or file names.

| File | Purpose |
|------|---------|
| `src/Security/CurrentUserResolver.php` | Resolves authenticated `User` entity from JWT token |
| `src/Security/CalendarMemberVoter.php` | Role check in the calendar's club (`CALENDAR_MEMBER` = staff, viewer+; plain `member` is always denied) |
| `src/Security/ClubMemberVoter.php` | Role check in the club: `CLUB_MEMBER` = staff (viewer+), `CLUB_EDITOR`, `CLUB_ADMIN`; `CLUB_ANY_MEMBER` (incl. role `member`) only for the allow-list (club read, leaving); new routes are staff-only by default, guarded by `tests/Controller/MemberRoleTest.php` |
| `src/Security/ArchivedCalendarVoter.php` | Blocks writes to archived calendars (`NOT_ARCHIVED`) |
| `src/EventListener/ExceptionListener.php` | Converts all exceptions to RFC 7807 `application/problem+json` (`src/Http/ProblemResponse.php`); access denied without a signed-in user → 401 `missing_token`; every 400 gets a code (framework 400s `invalid_request`, array query parameters `validation_failed` + `field`) |
| `src/Security/JwtProblemListener.php` | 401 problems of the JWT bundle: `missing_token`, `invalid_token`, `token_expired` (`WWW-Authenticate: Bearer`) |
| `src/EventListener/ConsentGateListener.php`, `src/Security/SessionConsentListener.php` | 403 `consent_required` gate for sessions without current legal consent (allow-list; claim `lc` from the access token) |
| `src/EventListener/EmailVerificationGateListener.php` | Restricted-session gate for unverified e-mail addresses (see `../CLAUDE.md` "Auth") |
| `src/EventListener/RequestContextListener.php`, `src/Security/TrustedHostsEnvVarProcessor.php` | Router context pinned to `BACKEND_URL`; `trusted_hosts` built from `APP_URL`/`FRONTEND_URL`/`BACKEND_URL`/`TRUSTED_HOSTS` |
| `src/EventListener/RevokeMcpGrantsOnSessionEnd.php` | Revokes MCP grants on every `User.tokenVersion` bump |
| `src/Service/Quota.php` | Per-resource limits, `assertRoom()` before every create (422 `quota_exceeded`); see `../CLAUDE.md` "Limits and Quotas" |
| `src/Doctrine/UpdateAuditListener.php` | Fills `updated_at`/`updated_by` of domain entities (`Entity\Trait\HasUpdateAudit`) |
| `src/Doctrine/ContentVersionListener.php`, `src/Service/CalendarVersionBumper.php` | `calendar.content_version` bump for the feed ETag; bulk statements call the bumper themselves (see `../CLAUDE.md` "Content version") |
| `src/Security/UserAgentSummary.php`, `bin/update-uap-regexes.php` | Browser name + major version from the User-Agent (result sanitized by `ClientContextSanitizer`: only A-Z a-z 0-9 space . - _, at most 20 characters, family shortened before the version) via `ua-parser/uap-php` (parser built once per process from the pre-converted `vendor/ua-parser/uap-php/resources/regexes.php`). `composer install` uses the data shipped with the package; the Docker build runs `php bin/update-uap-regexes.php` (fetch uap-core, verify in a temp dir, replace; failure keeps the shipped data). Refresh locally the same way or with `composer update ua-parser/uap-php`. Do not use `vendor/bin/uaparser` (needs `Application::add`, gone in Symfony 8) |
| `src/Security/AuthRateLimiter.php` | All rate limits (limiters in `config/packages/rate_limiter.yaml`), 429 `rate_limited` |
| `src/Security/OneTimeTokenService.php` | Purpose-bound single-use login tokens (e-mail confirmation, SSO code exchange) |
| `src/Service/EmailVerificationService.php` | 6-digit e-mail confirmation codes (hashed, attempts and resend limits) |
| `src/Service/ClubCreationPolicy.php`, `src/Command/ClubCreateCommand.php` | `RESTRICT_CLUB_CREATION` check (403 `club_creation_restricted`, bootstrap exception with `RESTRICT_REGISTRATION` and no club); `app:club:create` bypasses it via the `ClubService` operator flag, quota still applies |
| `src/Service/RegistrationPolicy.php` | `RESTRICT_REGISTRATION` check (open club invitation or valid `FeedProof`, see CLAUDE.md "Restricted registration") |
| `src/Pdf/` | PDF export: `PdfExportService` (view model + Twig `templates/pdf/`), `PdfHolidaySelection`/`PdfHolidays` (optional holiday shading), `DompdfFactory` (hardened), `EmojiImages` (allow-list), layout/option classes |
| `src/Ics/IcsEventReader.php`, `src/Service/IcsService.php` | Array-row ICS read path and streamed ICS output; ICS output changes raise `IcsService::FORMAT_VERSION`; event `SUMMARY` is `emojis name (extras)`, `DESCRIPTION` carries a badge legend (see `../CLAUDE.md` "ICS Feed Endpoint") |
| `src/EventListener/FeedResponseHeadersListener.php` | `Referrer-Policy: no-referrer` + `X-Robots-Tag: noindex` on `/api/feed/*`, except successful responses of an indexable feed (`robotsTag()` reads the request attribute `feed_indexable` set by `PublicFeedService` after the access checks; missing → noindex) |
| `src/Controller/AbstractApiController.php` | Base controller with `validateDto()` and `decodeJson()` helpers (no JSON object → 400 `invalid_request`) |
| `src/Service/TokenService.php` | Creates JWT access tokens (lexik) and HMAC refresh tokens (claims `uid`, `tv` = `user.token_version`) |
| `src/Security/SessionVersionListener.php` | Rejects JWTs whose `tv`/`uid` no longer match the user (sessions ended after credential resets) |
| `src/Security/Secret/` (`SecretCipher`, `EncryptedColumns`, `SecretRotator`), `src/Doctrine/Type/Encrypted*SecretType.php`, `src/Command/SecretsRotateCommand.php` | Encryption at rest of feed, subscription and TOTP secrets with a key derived from `APP_SECRET`, key ring `APP_SECRET_PREVIOUS`, `app:secrets:rotate` (see `../CLAUDE.md` "Secrets at rest"); raw SQL touching these columns must encrypt/decrypt itself |
| `src/Security/SignedTokenService.php`, `NonceStore.php` | Signed, purpose-bound, single-use tokens (passkey challenges, OAuth `state`, SSO link ticket/state/proof; table `auth_nonce`); `NonceStore::consume` is one atomic `INSERT ... ON DUPLICATE KEY UPDATE` (affected rows 1/2 = won, 0 = live row, already used; an expired row of the same key is renewed in place), with no separate DELETE, so parallel consumers, also inside transactions, cannot deadlock |
| `src/Service/PasswordResetService.php` | Forgot / reset password: hashed one-time tokens (table `password_reset`, 60 min), single conditional UPDATE against races, ends all sessions |
| `src/Service/AccountService.php` | Change password (new tokens), e-mail change with confirmation link (table `email_change`, no oracle), unlink SSO (last sign-in method stays) |
| `src/Service/DeferredMailer.php`, `AccountMailer.php` | Mails (and `defer()`red work such as the forgot-password lookup and token) after the response (`kernel.terminate`, no timing oracle; transport errors are logged, never raised); links only from `FRONTEND_URL` / `BACKEND_URL`; notices (password changed, e-mail change requested / done) carry no token and no link but `/forgot-password`, the new address masked (`maskEmail`) |
| `src/Validator/PasswordPolicy.php` | The one password policy (8–128 characters) for registration, reset and change |
| `src/Entity/UserTotp.php`, `MfaBackupCode.php`, `SecurityEvent.php`, `src/Enum/SecurityEventType.php`, `src/Repository/{UserTotp,MfaBackupCode,SecurityEvent}Repository.php` | MFA factor/backup-code/security-event data model (UUID v7, CASCADE with the user, not audited); backup codes are salted bcrypt hashes (hasher `backup_code`, unpeppered); `MfaBackupCodeRepository::consume($id)` and `UserTotpRepository::advanceStep()` are conditional UPDATEs (single use / replay protection); `User::mfaEnforced` is the MFA switch |
| `src/Service/MfaService.php`, `MfaLoginService.php`, `src/Controller/MfaController.php` (sign-in step, `/api/auth/mfa/verify`, `passkey/*`), `MfaManagementController.php` (`setup`, `enable`, `disable`, `backup-codes`, `code`), `SessionController.php` (`sessions/sign-out-others`) | MFA: status/setup/enable/disable/backup codes (`MfaService`, signed setup token, user row lock) and the login challenge with `mfaToken`, per-token guess slots in `NonceStore` and the single transaction of `attempt()` (`MfaLoginService`); details in CLAUDE.md "Auth" |
| `src/Security/StepUp/{RequiresStepUp,StepUpTokenService,StepUpListener}.php`, `src/Service/StepUpService.php`, `src/Security/Mfa/MfaFailureBudget.php`, `src/Controller/StepUpController.php` | Step-up confirmation: `#[RequiresStepUp]` attribute checked by `StepUpListener` (`kernel.controller`, header `X-Step-Up-Token`), 10-minute token bound to user, `tv` and refresh family `fam`; `StepUpService` verifies password/mailed code plus the MFA factor in a user-row-locked transaction; `MfaFailureBudget` is the single exact per-user failure budget shared with `MfaLoginService` (details in CLAUDE.md "Auth") |
| `src/Service/SecurityEventLogger.php`, `src/Security/ClientContext.php`, `ClientContextResolver.php`, `Location.php`, `LocationResolver.php`, `LocationResolverFactory.php`, `MaxMindLocationResolver.php`, `HeaderCountryLocationResolver.php`, `UserAgentSummary.php` | Security event log (failures folded per user, type, method, provider, IP and UTC hour by the unique `security_event.dedupe_key` (`INSERT`/`UPDATE` on that key), 50 failure rows per user and UTC day enforced under a per-user `GET_LOCK`; the lock wait is 0.5 s; on a timeout the atomic `INSERT ... ON DUPLICATE KEY UPDATE attempts = attempts + 1` on the unique key is used, so no count is lost and no request waits seconds, only the daily cap may be exceeded by a parallel burst; mail on the 3rd failure within an hour) and the client context (IP, browser, approximate location; `ClientContext` reduces the browser to an allow-listed name (`ClientContextSanitizer::KNOWN_BROWSERS`: Chrome, Firefox, Safari, Edge, ...) plus a 1-3 digit major version, anything else is null; the raw User-Agent (`userAgent`, max. 512 chars, control characters removed) goes only into the `security_event.user_agent` column, never into mails or UI; city (letters/digits, 100) and country (2 letters A-Z) in its constructor) for notices; `RedactTokensProcessor` also masks `mfaToken`, `setupToken`, `challengeToken`, `backupCode(s)` (also indexed), `otpauthUri`, `otpauth://` URIs, `password`/`newPassword`/`currentPassword`, `Authorization`/`Bearer` values, MFA and backup codes under `code` (JSON, double-encoded JSON, forms) and sensitive KEYS inside nested context arrays; MaxMind with a licence key, else the proxy country header (`CLIENT_COUNTRY_HEADER`, default empty) |
| `src/Command/GeoIpUpdateCommand.php`, `UserDisableMfaCommand.php`, `PruneSecurityEventsCommand.php` | `app:geoip:update` (weekly, no-op without a licence key), `app:user:disable-mfa <id\|email>` (operator recovery), `app:prune-security-events` (older than one year) |
| `src/Logging/RedactTokensProcessor.php` | Monolog processor: `token`/`ticket`/`secret`/`access_token`/… query values in log records (exceptions carrying them become redacted arrays) → `[redacted]`. Best effort: redaction can never fully exclude that a secret ends up in a log in an error case, so never log request bodies |
| `src/Command/` | `app:secrets:rotate`, `app:prune-unverified-users`, `app:prune-password-resets` (cron), `app:user:verify <email>`, `app:user:reset-link <email>` (support / dev / E2E) |
| `src/Service/CalendarReferences.php` | Resolves location/template/property/feature/target-group IDs within one calendar (unknown or foreign → 422) |
| `src/Service/LinkCollectionSync.php` | Syncs join-table collections by diff (deduplicated IDs, no identity collisions) |
| `src/Service/Input.php` | Typed input validation helpers (400 `validation_failed` with `field`, also invalid time zones; 422 is reserved for DTO constraints and state conflicts); `optionalDate` / `assertDateRange` for `from`/`to` query parameters (strict `YYYY-MM-DD`, never `strtotime`) |
| `src/Service/EventImportService.php` | ICS import: preview (`new`/`duplicate`/`invalid` per entry, writes nothing) and atomic import (new places by `tempId`, `skipDuplicates`, unknown time zones → calendar zone + `warnings`, max. 5000 per request → 413 `too_many_events`) |
| `src/Service/EventExportService.php` | Member ICS download via `IcsService` (`from`/`to` overlap, `includeDrafts` as TENTATIVE, `targetGroupIds[]` of the calendar, safe `Content-Disposition`) |
| `src/Service/SeriesRule.php` | Series rule (weekly / biweekly / monthly n-th weekday, `until` or `count`, `skipHolidays`, `durationDays`): validation and the ONLY computation of series dates (calendar days in UTC), max. 366 events (422 `too_many_events`) |
| `src/Service/EventSeriesService.php` | Series preview (dates, skipped holidays of the calendar's holiday calendars) and atomic creation of series + events (template values like `from-template`); rule change (`previewUpdate` / `update`: future events only, today in the calendar's zone via `ClockInterface`, prototype = earliest future event, series row locked, max. 366 events afterwards, 409 `series_empty` / `series_changed`); scope `this`/`all` of PATCH/DELETE and the clean-up of empty series live in `EventService` |
| `src/Service/UsageCounts.php` | Counters for lists and delete dialogs (clubs, calendars, usage of properties/features/target groups/locations, events per template): one grouped query per counter, never one per row |
| `src/Service/UniqueNames.php` | Names of properties/features/target groups unique per calendar (trim, case-insensitive, compared in PHP; no unique index, old duplicates stay) |
| `src/Exception/ApiProblemException.php` | HTTP error with a stable `code` (+ optional `field`) in the RFC 7807 body, e.g. 422 `duplicate_name`; code list: `ErrorCode` in `../docs/api/openapi.yaml` |
| `config/services.yaml` | Parameters and env defaults: `APP_URL` drives `FRONTEND_URL`, `BACKEND_URL` and `WEBAUTHN_RP_ID`; optional `MAPBOX_TOKEN`, cache TTLs, `WEBAUTHN_USER_VERIFICATION` |
| `config/packages/security.yaml` | Stateless JWT firewall; `access_control` is deny-by-default: an explicit `PUBLIC_ACCESS` allow-list, then a final `^/api` `IS_AUTHENTICATED` rule (401 before the entity lookup). A new public route needs its own rule there and an entry in `PUBLIC_PATTERNS` of `tests/Unit/AccessControlCoverageTest.php` (L11) |
| `migrations/` | Doctrine migrations; do not list versions here |

## Security Pattern

Controllers use `$this->denyAccessUnlessGranted(VoterConstant::ATTRIBUTE, $entity)` to enforce authorization.

```php
// Example: calendar endpoint
$calendar = $this->em->getRepository(Calendar::class)->find($calendarId);
$this->denyAccessUnlessGranted(CalendarMemberVoter::CALENDAR_MEMBER, $calendar);
$this->denyAccessUnlessGranted(ArchivedCalendarVoter::NOT_ARCHIVED, $calendar); // only on writes
```

## Auth

See `../CLAUDE.md` "Auth" and `../docs/api/openapi.yaml`.

## Entity Conventions

- PHP camelCase properties → snake_case DB columns (UnderscoreNamingStrategy)
- All relations use cascade delete (carried over from the original Prisma schema)
- Join table entities (e.g. `EventProperty`, `ClubUser`) use composite `#[ORM\Id]`
- `FeedVisibility` is a PHP 8.1 backed enum mapped via `enumType` (VARCHAR column): `PUBLIC`, `CLUB` (default for new feeds), `PRIVATE`. `PUBLIC` and `CLUB` are reachable without the secret and differ only in indexing; `PRIVATE` requires the secret (`requiresSecret()`); switching from `PUBLIC`/`CLUB` to `PRIVATE` always generates a new secret (`FeedService::update()`). `isIndexable()` = `PUBLIC` (CLUB and PRIVATE are never indexed; no separate setting since `Version20261021120000`). Feed responses carry `indexable`, the public feed header `visibility` and `indexable`
- IDs are UUID v7 strings, audit fields on domain entities: `../CLAUDE.md` working rule 4 and "Audit fields"

## Testing

Tests are in `tests/Controller/` using `Symfony\Bundle\FrameworkBundle\Test\WebTestCase`.
`tests/Helper/DatabaseResetter::reset($em)` truncates all tables before each test class.
`tests/Helper/TestHelper` provides factory helpers: `createUser`, `createClub`, `createCalendar`, `createEvent`, `createTemplate`.
`tests/Helper/QueryCounter` (DBAL middleware, registered only in `config/services_test.yaml`) counts SQL statements:
list endpoints are tested to run the same number of queries for more rows (no N+1, see `CountersTest`).
The KernelBrowser reboots the kernel between requests: re-fetch entities (`$em->find(...)`) before changing them
after a request.

Run and DB setup: `../CLAUDE.md` "Tests".

## Calendar Archive & Duplicate

- `Calendar::archivedAt` — null = active; set = archived and read-only
- `POST /api/clubs/{clubId}/calendars/{calendarId}/archive` — sets `archivedAt`
- `POST /api/clubs/{clubId}/calendars/{calendarId}/unarchive` — clears `archivedAt`
- `POST /api/clubs/{clubId}/calendars/{calendarId}/duplicate` (201) — deep-copies calendar + properties/features/target-groups/locations/templates/feeds (new feed secrets, same visibility); events (and therefore event series) not copied; optional body `{name}` (default "Copy of …", the frontend sends the localized name)
- Calendar responses carry `eventCount`, `templateCount`, `feedCount`; club responses `calendarCount`, `archivedCalendarCount`, `memberCount` (single club also `eventCount`, `feedCount`); `GET /api/clubs` also the caller's `lastCalendarId` per club (`club_user.last_calendar_id`, set by `PATCH /api/auth/me`)
- Event templates: `timezone`, `timeBegin`, `timeEnd` are optional (times only as a pair); without times in the template and in the request, `from-template` creates all-day events (`../docs/api/openapi.yaml`)
- Archived calendar public feeds → 404; nested write endpoints → 403 (via `ArchivedCalendarVoter`)

## Event Series

- `EventSeries` (`event_series`: rule + optional template, FK calendar CASCADE, template SET NULL) and `Event.series` (`series_id`, SET NULL). The events are normal rows; the rule is re-evaluated only when it is changed.
- `POST …/event-series/{id}/preview-update {rule}` → `{toCreate, toDelete, kept, past, skippedHolidays}`; `PATCH …/event-series/{id} {rule}` → `{series, created, deleted, kept}`: future events (date ≥ today in the calendar's zone) on dates of the new rule stay, missing dates are created from the prototype (earliest future event), other future events are deleted; past events never change (`EventSeriesRuleChangeTest`).
- `POST …/events/series/preview {rule}` → `{dates, count, skippedHolidays, holidays}`; `POST …/events/series {rule, templateId?, event?, isDraft?}` → 201 `{series, events}` (one flush); lists carry `seriesId`, the single event GET also `series {id, rule, eventCount, …}`.
- `PATCH …/events/{id}` `scope: "all"` applies the sent fields to every event of the series except `date`/`dateEnd`/template (each event keeps its day); `this` (default) changes one event, which stays in the series. `DELETE …?scope=all` deletes the series with its events; a series without events is removed (also after bulk delete). Details: `../docs/api/openapi.yaml`.
