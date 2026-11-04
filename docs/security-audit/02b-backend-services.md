# Backend Services Security Audit (Feeds, ICS & Map)

## Scope

Service-layer security review of the feed, ICS, and map subsystems:

- `src/Service/FeedService.php`, `src/Service/PublicFeedService.php`, `src/Service/IcsService.php`
- `src/Service/Map/` — `MapboxProxyService`, `MapboxMapImageProvider`, `RateLimitedMapImageProvider`, `BaseGeocodeDecorator`, `NominatimGeocodeDecorator`, `MapboxGeocodeDecorator`
- `src/Controller/FeedController.php`, `src/Controller/PublicFeedController.php`, `src/Controller/MapboxController.php`, `src/Controller/MapController.php` (authorization and input handling only)
- `src/Entity/CalendarFeed.php` (secret handling), `src/Entity/FeedVisibility.php`
- Configuration: `config/packages/rate_limiter.yaml`, `config/services.yaml` (mapbox pattern list, cache TTLs), `config/packages/security.yaml` (firewall coverage of `/api/mapbox`, `/api/map`, `/api/feed`)

## Method

Documentation-only audit. Source was inspected via targeted `grep` and narrow line-range reads (no full-file dumps). Verified against actual behavior: firewall routing (stateless JWT `api` firewall vs. anonymous `public_feed` firewall), rate-limiter bucket definitions and where each bucket is checked, Mapbox upstream URL handling, ICS output paths (library rendering vs. hand-built lines), and access-control checks in public feed delivery. Findings reference file and line numbers as of this commit. No secrets, tokens, or API keys are reproduced in this report.

Date: 2026-10-05

### API-53 — Static map image endpoints expose coordinates of calendars a user is not a member of

**Severity:** Low

**Attack scope:** Any authenticated user (valid JWT); only a UUID of the target event or location is required. No club or calendar membership check.

**Description:**
`GET /api/map/image/location/{id}` and `GET /api/map/image/event/{id}` verify only authentication (via the `api` firewall) plus the geocode-route `ROLE_USER` for other sub-routes; they perform **no membership check** against the location's or event's calendar/club. There is no `denyAccessUnlessGranted(CalendarMemberVoter::CALENDAR_MEMBER, ...)` or equivalent. Consequently, any logged-in user who knows or guesses a location/event UUID can render a Mapbox static image that reveals the exact coordinates of a non-public calendar's location or event.

`Calendar` has no `visibility`/`isPrivate` field, so "non-public" here means "belongs to a club the caller is not a member of". The event variant additionally has the comment "Public endpoint — only non-draft events" and filters drafts, but a non-draft event in another club's calendar is still served. The rendered image itself leaks the coordinates visually (grid + marker at the target point) even without reading the URL parameters.

The same UUID-enumeration caveat applies as for the public feed: IDs are UUIDv7 (time-ordered, 122-bit random suffix), so brute force is impractical, but UUIDs are shared in many places (URLs, logs, frontend state), so "unknown UUID" is a weak protection. The `location` variant is the sharper edge because locations have no draft state at all.

**Affected parts:**
- `backend/src/Controller/MapController.php:100-133` — `image` and `imageEvent` actions; no voter/ownership check before delegating to `mapImageProvider`
- `backend/src/Controller/MapController.php:115` — "Public endpoint" comment on the event variant

**Fix recommendation:**
Load the `Location`/`Event`, resolve its calendar, and enforce `CalendarMemberVoter::CALENDAR_MEMBER` (plus `ArchivedCalendarVoter::NOT_ARCHIVED` if images should also be blocked for archived calendars) before rendering. Return 404 (not 403) for non-members to avoid UUID enumeration confirmation, mirroring the public-feed behavior.

**Notes:**
The geocode routes in the same controller correctly enforce `ROLE_USER` and per-user rate limiting, so the gap is specific to the two image actions. No secrets or tokens are exposed by the image response itself; the finding is coordinate disclosure of non-member calendars.

## Reviewed & OK

- **SSRF (Mapbox proxy):** `MapboxProxyService::callUpstream()` hardcodes `https://api.mapbox.com/` as the upstream host and only the path is taken from the request. Path traversal is rejected for any `..` segment, including iterative double-encoding (decode-then-check loop, `str_replace('\\', '/', ...)` normalization, and a final `str_contains($path, '..')` guard). An explicit regex allowlist (`^[a-z0-9._/\-]+$` plus a `rate_limited` pattern match) is applied before any upstream call. The caller's own `access_token` query parameter is stripped and replaced with the server-side token, so no user-supplied value can reach the upstream host. SSRF cleared.
- **SSRF (geocoders):** Both `NominatimGeocodeDecorator` and `MapboxGeocodeDecorator` call fixed upstream hosts (`nominatim.openstreetmap.org`, `api.mapbox.com`) with server-side tokens; user input is passed only as a query parameter, never as a host, scheme, or path. Geocoder cleared.
- **Public feed access control:** `PublicFeedService::getEvents()` first checks `sharedSecret` with `hash_equals` (constant-time) and returns 403 before any other state is revealed; archived calendars return 404; the target-group filter only *narrows* the feed's own group list via `array_intersect`, so a caller cannot widen scope by supplying extra groups; only non-draft events are returned. UUIDv7 feed IDs make feed-ID enumeration impractical (the 403-vs-404 distinction on a wrong secret is noted but not actionable at this entropy).
- **Public feed ICS delivery:** `PublicFeedController::ics()` sets `text/calendar; charset=utf-8`, `Content-Disposition: attachment` with a sanitized filename, and `Cache-Control: no-cache, no-store`. The JSON variant sets a `Content-Type` but no explicit cache headers (minor, not a finding).
- **Feed management authorization:** Every `FeedController` endpoint enforces `CALENDAR_MEMBER` (and `NOT_ARCHIVED` on writes); feed CRUD is correctly scoped to calendar members.
- **ICS timezone output:** `buildVTimezone()` emits standard/daylight components only for ranges where `startTimestamp`/`endTimestamp` actually bound the rule, avoiding out-of-range RDATE expansion; DST transitions use the correct `TZID`/`TZOFFSET` pairs.
- **Archived calendar feeds:** Public feed of an archived calendar returns 404 (calendar-level check before secret check is short-circuited correctly); nested write endpoints return 403 via `ArchivedCalendarVoter`.
- **Negative caching:** 404/410 upstream responses are cached with a short TTL to avoid repeated upstream hammering on dead tiles.
- **Geocoder rate limiting:** Per-user 50/1h plus a 3,000/24h system cap, with caching, and `ROLE_USER` enforcement on the geocode routes — adequately mitigated.
