# Backend API Security Audit (Authorization & CRUD)

## Scope

Backend authorization and CRUD endpoints of the Symfony 8.1 API (`backend/`), excluding the auth mechanisms audited in `01-backend-auth.md`:

- `src/Controller/`: `ClubController`, `CalendarController`, `EventController`, `EventTemplateController`, `PropertyController`, `FeatureController`, `TargetGroupController`, `LocationController`, `FeedController`, `PublicFeedController`
- Their services: `ClubService`, `CalendarService`, `EventService`, `EventTemplateService`, `PropertyService`, `FeatureService`, `TargetGroupService`, `LocationService`, `FeedService`, `PublicFeedService`; shared `Service\Input` validation helpers
- `src/Security/`: `CalendarMemberVoter`, `ClubMemberVoter`, `ArchivedCalendarVoter`, `CurrentUserResolver`; `config/packages/security.yaml`
- DTOs and validation used by these controllers (`src/Dto/`, `ValidationTrait`)

Out of scope: auth/WebAuthn/OAuth/Mapbox controllers, frontend, dependencies and secrets, ICS generation internals, `HolidayCalendar`/`HolidayEvent`/`Map`/`Health` controllers.

## Method

Static, read-only code review: full reads of every in-scope controller, service, security voter, and DTO, plus `security.yaml` and the initial schema migration for the data model. Every route was mapped to its voter attributes and service call path; each candidate finding was re-verified against the exact code before inclusion; false positives were dropped. Severity scale: Critical / High / Medium / Low / Informational.

## Date

2026-10-05

### API-01 — Club membership grants full administrative control (no roles, no last-admin guard)
**Severity:** High
**Attack scope:** Any authenticated member of a club (including a single compromised or malicious account)
**Description:** The club data model has no role, owner, or last-admin concept — `ClubUser` is a plain club+user join with no role column, and `ClubService` performs no privilege checks of any kind. As a result every club member can: delete the entire club (`deleteClub`), remove **any** member including themselves (which can orphan a club with zero members but no deletion cascade), add **any** user by email address (`addMember`), and rename the club or change its timezone (`updateClub`). A single low-privilege member account is equivalent to full club admin, and a departing user can self-remove and leave the club unmanageable.
**Affected parts:** `ClubController.php` (all 8 routes guarded only by `CLUB_MEMBER` — PATCH/DELETE/members endpoints, lines 64-110); `ClubService.php:56` (updateClub), `:69` (deleteClub), `:86` (addMember), `:105` (removeMember); `ClubUser` entity (composite `clubId`+`userId` IDs, no role)
**Fix recommendation:** Introduce a role or owner concept (e.g. `role` on `ClubUser`), gate club deletion, member removal, member addition, and club metadata changes to club admins/owner; block removal of the last remaining admin (and optionally of oneself if it orphans the club); consider re-authentication or a confirmation step for club deletion.
**Notes:** The membership voter itself works as designed — the gap is the missing privilege layer above it. Member self-removal and club deletion by any member are the two most dangerous sub-cases.

### API-02 — Archived calendars can still be updated, deleted, and duplicated
**Severity:** Medium
**Attack scope:** Any authenticated member of the calendar's club
**Description:** `ArchivedCalendarVoter::NOT_ARCHIVED` is applied to all nested write endpoints (events, templates, properties, features, target groups, locations, feeds), but the calendar-level write routes — `PATCH`, `DELETE`, and `duplicate` — carry no such attribute, and `CalendarService` has no `archivedAt` guard in `updateCalendar`, `deleteCalendar`, or `duplicateCalendar`. Archiving a calendar therefore does not make it read-only with respect to its own metadata, identity, or existence, contradicting the documented behavior ("archived = read-only"; nested writes → 403).
**Affected parts:** `CalendarController.php` (PATCH / DELETE / duplicate routes lack `#[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED)]`); `CalendarService.php:67` (updateCalendar), `:80` (deleteCalendar), `:102` (duplicateCalendar); `ArchivedCalendarVoter.php` (guard never reached for these routes)
**Fix recommendation:** Add `#[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]` to the calendar PATCH, DELETE, and duplicate routes and/or enforce `archivedAt === null` inside the three `CalendarService` methods (defense in depth).
**Notes:** The unarchive route intentionally has no such guard. Duplicating an archived calendar creates a new active calendar, which may be a feature, but it is inconsistent with the read-only contract; at minimum the behavior should be a deliberate, documented choice. `archiveCalendar` is idempotent (re-archiving is a no-op).

### API-03 — Unbounded list and bulk-operation endpoints

> **Status (git-log check 2026-10-15): PARTIALLY FIXED** — max 5000 events per import/preview and 5000 ids per bulk request (413 `too_many_events`, `8913ce8`), max 366 events per series (`eacd4d0`). **`listEvents` pagination not confirmed.**
**Severity:** Low
**Attack scope:** Any authenticated member of the calendar's club
**Description:** `EventService::listEvents` applies no pagination or row limit, so a single request can force a full scan/serialization of every event (and its properties) in a large calendar. Similarly, `createSeriesFromTemplate` accepts an unbounded `$dates` array and `importEvents` an unbounded `$eventsData` array, allowing one request to create an arbitrarily large batch of events.
**Affected parts:** `EventService.php:30-67` (listEvents, no limit), `:77` (createSeriesFromTemplate, unbounded `$dates`), `:115` (importEvents, unbounded `$eventsData`)
**Fix recommendation:** Add server-side caps: offset/limit (or cursor) pagination for `listEvents`, and a maximum batch size for the `$dates` / `$eventsData` arrays (reject or truncate beyond it with a clear 400/422).
**Notes:** All endpoints require `CALENDAR_MEMBER` (plus `NOT_ARCHIVED` for the mutators), so this is resource exhaustion by a legitimate member rather than an unauthenticated DoS; no data leak involved.

## Reviewed & OK

- **Route authorization coverage:** every in-scope route requires authentication; per-resource routes enforce the matching membership voter — club routes via `CLUB_MEMBER`, all calendar sub-resources via `CALENDAR_MEMBER`. List/getOne routes require membership only; all nested create/update/delete routes additionally carry `NOT_ARCHIVED` (verified per route against `EventTemplateController`, which is the reference pattern).
- **IDOR / cross-tenant access:** none found. All sub-resource lookups are re-scoped by calendar: `EventService::findEvent` (line 154) re-queries by calendar and returns 404 for cross-calendar IDs; Property/Feature/TargetGroup/Location/Feed services resolve IDs through calendar-scoped private `find()`; event property/template/target-group references go through `Service\Input` helpers that are calendar-scoped (unknown or cross-calendar IDs → 422, no leakage). Calendar↔club binding is enforced at routing via `#[MapEntity(expr: 'repository.findByIdAndClubId(calendarId, clubId)')]` — a calendar in the wrong club 404s.
- **Archived-calendar enforcement (nested writes):** `NOT_ARCHIVED` present on all event, template, property, feature, target-group, location, and feed create/update/delete routes; public feeds of archived calendars return 404 (`PublicFeedService::loadFeed`). See API-02 for the calendar-level gap.
- **Public feed (`/api/feed/...`):** public by design (`public_feed` firewall, `security: false`). `loadFeed` requires the correct secret for PRIVATE feeds compared with `hash_equals`; the archived→404 check runs after the secret check (no archive-state leakage to unauthenticated callers); `loadEvents` filters out drafts; the target-group filter can only narrow to the feed's own groups (no way to widen access).
- **Event input handling:** `EventService::applyInput` (lines 181-252) is a strict whitelist of known fields; every value passes `Service\Input` helpers; `dateEnd < date` is rejected; PATCH applies only present keys — no mass-assignment surface.
- **DTO validation:** `CreateClubDto`, `UpdateClubDto`, `AddMemberDto`, and `Calendar/CreateCalendarDto` carry Symfony constraints (`NotBlank`, `Length` max 255, `Timezone(zone: ALL_WITH_BC)`, `Email`); `ValidationTrait::validate` converts violations to `ValidationFailedException` (400). All other payloads are handled by service-level `Service\Input` helpers with the same validation guarantees.
- **`security.yaml`:** the `api` firewall is a stateless JWT firewall; `public_feed` is the only `security: false` route group; `access_control` is empty, so authorization rests entirely on route attributes + voters — coverage verified per controller above. `CurrentUserResolver` re-loads the user and 401s if missing.
- **Minor observations (no findings filed):** PATCH semantics are inconsistent — `CalendarService::updateCalendar` uses `array_key_exists` (explicit `null` clears a field) while `ClubService::updateClub` uses `isset` (explicit `null` is ignored); `removeMember` accepts a raw `string $userId` with no format validation (invalid values simply 404).
