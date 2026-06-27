# Club Calendar — Agent Guide

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
| Feeds | `/api/calendars/{calendarId}/feeds` | `FeedController` | `FeedService` |
| Public Feed | `/api/feed` | `PublicFeedController` | `PublicFeedService`, `IcsService` |
| Mapbox Proxy | `/api/mapbox` | `MapboxController` | — |

## Common Infrastructure

| File | Purpose |
|------|---------|
| `src/Security/CurrentUserResolver.php` | Resolves authenticated `User` entity from JWT token |
| `src/Security/CalendarMemberVoter.php` | Checks user is a member of the calendar's club (`CALENDAR_MEMBER`) |
| `src/Security/ClubMemberVoter.php` | Checks user is a club member (`CLUB_MEMBER`) |
| `src/Security/ArchivedCalendarVoter.php` | Blocks writes to archived calendars (`NOT_ARCHIVED`) |
| `src/EventListener/ExceptionListener.php` | Converts all exceptions to RFC 7807 `application/problem+json` |
| `src/Controller/AbstractApiController.php` | Base controller with `validateDto()` and `decodeJson()` helpers |
| `src/Service/TokenService.php` | Creates JWT access tokens (lexik) and HMAC refresh tokens |
| `config/packages/security.yaml` | Stateless JWT firewall; public routes allowlist |
| `migrations/Version20260625000000.php` | Initial schema migration (all tables in snake_case) |

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
- **No cookies** — the backend sets no cookies

## Entity Conventions

- PHP camelCase properties → snake_case DB columns (UnderscoreNamingStrategy)
- All relations use cascade delete matching the Prisma schema
- Join table entities (e.g. `EventProperty`, `ClubUser`) use composite `#[ORM\Id]`
- `FeedVisibility` is a PHP 8.1 backed enum mapped via `enumType`
- **Entity IDs are always UUIDs** — use `#[ORM\Column(length: 36)]` with `Uuid::v7()->toRfc4122()` assigned in the constructor. Never use `#[ORM\GeneratedValue]` or `int` IDs. `getId()` returns `string`.
- **Frontend types for entity IDs are always `string`** — never `number`

## Testing

Tests are in `tests/Controller/` using `Symfony\Bundle\FrameworkBundle\Test\WebTestCase`.
`tests/Helper/DatabaseResetter::reset($em)` truncates all tables before each test class.
`tests/Helper/TestHelper` provides factory helpers: `createUser`, `createClub`, `createCalendar`, `createEvent`, `createTemplate`.

Run: `cd backend && composer test` (requires MySQL test DB on port 3360)

## Calendar Archive & Duplicate

- `Calendar::archivedAt` — null = active; set = archived and read-only
- `POST /api/clubs/{clubId}/calendars/{calendarId}/archive` — sets `archivedAt`
- `POST /api/clubs/{clubId}/calendars/{calendarId}/unarchive` — clears `archivedAt`
- `POST /api/clubs/{clubId}/calendars/{calendarId}/duplicate` (201) — deep-copies calendar + properties/features/target-groups/locations/templates/feeds (new UUIDs for feed secrets); events not copied
- Archived calendar public feeds → 404; nested write endpoints → 403 (via `ArchivedCalendarVoter`)
