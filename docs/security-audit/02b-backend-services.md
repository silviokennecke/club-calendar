# Backend Services Security Audit (Feeds, ICS & Map)

## Scope

Service-layer security review of the feed, ICS, and map subsystems:

- `src/Service/FeedService.php`, `src/Service/PublicFeedService.php`, `src/Service/IcsService.php`
- `src/Service/Map/` — `MapboxProxyService`, `MapboxMapImageProvider`, `RateLimitedMapImageProvider`, `BaseGeocodeDecorator`, `NominatimGeocodeDecorator`, `MapboxGeocodeDecorator`
- `src/Controller/FeedController.php`, `src/Controller/PublicFeedController.php`, `src/Controller/MapboxController.php`, `src/Controller/MapController.php` (authorization and input handling only)
- `src/Entity/CalendarFeed.php` (secret handling), `src/Entity/FeedVisibility.php`
- Configuration: `config/packages/rate_limiter.yaml`, `config/services.yaml` (mapbox pattern list, cache TTLs), `config/packages/security.yaml` (firewall coverage of `/api/mapbox`, `/api/map`, `/api/feed`)

## Method

Documentation-only audit. Source was inspected via targeted `grep` and narrow line-range reads (no full-file dumps). Verified against actual behavior: firewall routing (stateless JWT `api` firewall vs. anonymous `public_feed` firewall), rate-limiter bucket definitions and where each bucket is checked, Mapbox upstream URL handling, ICS output paths (library rendering vs. hand-built lines), and access-control checks in public feed delivery. Verified again against the code on 2026-11-05 (branch `security/audit-followup`). No secrets, tokens, or API keys are reproduced in this report.

Date: 2026-10-05

## Findings

API-53 (public static map image endpoints, merges former L5) is the only open finding of this area; the entry is in `SECURITY_AUDIT_REPORT.md`.

## Reviewed & OK

- **SSRF (Mapbox proxy):** `MapboxProxyService::callUpstream()` hardcodes `https://api.mapbox.com/` as the upstream host and only the path is taken from the request. `matchPattern()` rejects `.`/`..` segments and backslashes after iterative URL decoding, then requires a match against `mapbox.allowed_patterns` (`services.yaml`: `/v4/{tileset}/{z}/{x}/{y}`, `/styles/`, `/fonts/`, GET only) before any upstream call. The caller's `access_token` query parameter is replaced with the server-side token. There is no private-IP filtering (not needed with a fixed host). The route requires a signed-in user (`security.yaml:50`). SSRF cleared.
- **SSRF (geocoders):** Both `NominatimGeocodeDecorator` and `MapboxGeocodeDecorator` call fixed upstream hosts (`nominatim.openstreetmap.org`, `api.mapbox.com`) with server-side tokens; user input is passed only as a query parameter, never as a host, scheme, or path. Geocoder cleared.
- **Public feed access control:** `PublicFeedService::loadFeed()` returns 404 for an unknown feed, then (PRIVATE feeds only) checks `sharedSecret` with `hash_equals` (constant-time) and answers 403 on a wrong or missing secret before any other state is revealed; a feed whose calendars are all archived returns 404; the target-group filter only *narrows* the feed's own group list via `array_intersect`, so a caller cannot widen scope by supplying extra groups; only non-draft events are returned. UUIDv7 feed IDs make feed-ID enumeration impractical (the 404-vs-403 distinction between an unknown feed and a PRIVATE feed with a wrong secret is noted but not actionable at this entropy).
- **Public feed ICS delivery:** `PublicFeedController::ics()` streams `text/calendar` with `Content-Disposition: attachment` and an ETag; `Cache-Control` is `public, no-cache` (PUBLIC/CLUB) or `private, no-cache` (PRIVATE) (`PublicFeedController.php:81`); the one-event ICS is `private, no-store` (`:58`).
- **Feed management authorization:** Every `FeedController` endpoint is club-scoped and enforces `ClubMemberVoter`: `CLUB_EDITOR` for the list and read routes, `CLUB_ADMIN` for create, update, delete and secret regeneration.
- **ICS output:** pinned byte for byte by `tests/Service/IcsGoldenTest.php` (`fixtures/ics-golden.txt`); VTIMEZONE blocks are emitted per used zone after the events (`IcsService`).
- **Archived calendar feeds:** a feed whose calendars are all archived returns 404, checked after the secret check of PRIVATE feeds (`PublicFeedService::loadFeed()`), so nothing is revealed without access; nested write endpoints return 403 via `ArchivedCalendarVoter`.
- **Negative caching:** 404/410 upstream responses are cached with a short TTL to avoid repeated upstream hammering on dead tiles.
- **Geocoder rate limiting:** Per-user 50/1h plus a 3,000/24h system cap, with caching, and `ROLE_USER` enforcement on the geocode routes — adequately mitigated.
