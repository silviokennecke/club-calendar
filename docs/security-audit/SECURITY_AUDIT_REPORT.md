# Club Calendar — Security Audit Report

**Date:** 2026-10-05
**Status:** 4 of 5 areas complete (backend auth, backend API, feeds/ICS/Map services, frontend); area `04` (dependencies, secrets, deployment config) is pending and marked below.

## Scope & Method

| Area | What was reviewed | Report |
|---|---|---|
| Backend auth | `AuthController`, `OAuthController`, `WebAuthnController`; `AuthService`, `TokenService`, `WebAuthnService`, email-verification services; security voters, JWT/security config; auth entities; migrations; `backend/.env.example` | `01-backend-auth.md` |
| Backend API (authorization & CRUD) | `Club/Calendar/Event/EventTemplate/Property/Feature/TargetGroup/Location/Feed/PublicFeed` controllers + services, security voters, DTOs, `security.yaml` | `02-backend-api.md` |
| Backend feeds/ICS/map services | `FeedService`, `PublicFeedService`, `IcsService`, `src/Service/Map/` (Mapbox proxy, map images, geocoding), `Feed` entity | `02b-backend-services.md` |
| Frontend | React SPA (Vite, React 19, TanStack Query), auth storage, OAuth callback, Mapbox proxy client, dependency spot-check | `03-frontend.md` |
| Scans & config | gitleaks (git history, project `.gitleaks.toml`), Trivy (Docker), dependency spot-checks (npm/composer), `../../docker-compose.yml`, service/env wiring | `04-scans-config.md` (pending) |

**Method:** Static, read-only code review (full reads of in-scope files, grep-first for known sink/pattern classes, targeted re-reads to verify exact behavior and line numbers) plus automated scans. Every finding was verified against the actual code path before inclusion; false positives were dropped. No fixes were implemented — documentation only. Secret values are never printed; they are referenced by name or a redacted placeholder.

## Severity Scale

| Level | Meaning |
|---|---|
| **Critical** | Actively exploitable: data breach, full account takeover, remote code execution |
| **High** | Realistic attack with significant impact (admin via a single compromised account, leaked credentials) |
| **Medium** | Exploitable under common conditions, or meaningful weakening of a security control |
| **Low** | Limited impact, requires a precondition (valid account, log access), or robustness issue |
| **Informational** | Hygiene/hardening notes; no direct vulnerability |

## Executive Summary

- **No Critical findings** in the completed areas.
- Counts so far (4 of 5 areas complete): **2 High, 4 Medium, 9 Low, 9 Informational** — 24 findings after consolidating one cross-area duplicate (AUTH-02 + FE-02); API-02 removed after implementation.
- **Immediate action (no code change required):** rotate the Mapbox token that leaked into git history (FE-01) — it remains valid and is recoverable from any clone of the repository.
- **Top design gaps:** club membership equals full admin with no role model (API-01); OAuth login returns the 7-day refresh token in the redirect URL (AUTH-02/FE-02); no rate limiting on login/register/refresh (AUTH-01); Mapbox egress is system-rate-limited only, with styles/fonts unlimited (API-52).
- **Positives:** no IDOR/cross-tenant gaps in the API surface; no live Mapbox token in the frontend (fully proxied through the backend); WebAuthn ceremonies, OAuth state handling, and exception → RFC 7807 response masking are sound; feed-secret checks are constant-time and the Mapbox proxy is SSRF-safe (fixed upstream host, strict path allowlist, caller token stripped).

## Findings

### High

#### FE-01 — Mapbox public token leaked in git history
**Severity:** High
**Attack scope:** Anyone with read access to the repository (including forked or leaked clones).
**Description:** A real Mapbox public token (`pk.eyJ1Ijoi…` [redacted — rotate it]) was committed on 2026-06-12 in commit `e0bbc0ab8847` at `frontend/src/components/locations/MapPicker.tsx:8`. A later commit deleted the file, but the token remains recoverable from history (`git show e0bbc0ab8847`), so removal from the working tree is not revocation. The token can be used to burn the project's Mapbox quota or hit plan limits. The same leak was independently confirmed by the gitleaks scan (rule `generic-api-key`; not covered by the project allowlist).
**Affected parts:** `frontend/src/components/locations/MapPicker.tsx` (deleted from tree; line 8 in commit `e0bbc0ab8847…`); `gitleaks.json` (not committed: contains the leaked token) (scan evidence, redacted in place).
**Fix recommendation:**
1. **Rotate the token in the Mapbox dashboard** — this is the only step that actually revokes it.
2. Either rewrite history (BFG / filter-repo) or at minimum note in the repo that the old token is void.
3. Keep the scan-evidence file redacted (done) so the secret is not re-committed in a second file.
**Notes:** The current design proxies all Mapbox traffic through the backend (see Reviewed & OK), so no live token exists in the frontend tree — this finding is about the leaked historical secret. Sub-step status: evidence file redacted and verified (2026-10-05); token rotation still open.
**Source:** `03-frontend.md` (FE-01), corroborated by the gitleaks scan.

#### API-01 — Club membership grants full administrative control (no roles, no last-admin guard)
**Severity:** High
**Attack scope:** Any authenticated member of a club — including a single compromised or malicious account.
**Description:** The club data model has no role, owner, or last-admin concept — `ClubUser` is a plain club+user join with no role column, and `ClubService` performs no privilege checks of any kind. As a result every club member can: delete the entire club, remove **any** member including themselves (which can orphan a club with zero members), add **any** user by email address, and rename the club or change its timezone. A single low-privilege member account is equivalent to full club admin, and a departing user can self-remove and leave the club unmanageable.
**Affected parts:** `ClubController.php` (all 8 routes guarded only by `CLUB_MEMBER`, lines 64–110); `ClubService.php:56` (updateClub), `:69` (deleteClub), `:86` (addMember), `:105` (removeMember); `ClubUser` entity (composite `clubId`+`userId` IDs, no role).
**Fix recommendation:** Introduce a role/owner concept (e.g. a `role` column on `ClubUser`); gate club deletion, member removal, member addition, and club metadata changes on club admin/owner; block removal of the last remaining admin (and consider self-removal that orphans the club); consider re-authentication or a confirmation step for club deletion.
**Notes:** The membership voter itself works as designed — the gap is the missing privilege layer above it. Member self-removal and club deletion by any member are the two most dangerous sub-cases.
**Source:** `02-backend-api.md` (API-01).

### Medium

#### AUTH-01 — No rate limiting on login, register, and token refresh
**Severity:** Medium
**Attack scope:** Unauthenticated external attacker (any IP).
**Description:** `POST /api/auth/login`, `POST /api/auth/register`, and `POST /api/auth/token` have no rate limiting; the only configured limiter is `email_verification_resend`. This enables online brute force / credential stuffing against login and mass account creation via register.
**Affected parts:** `AuthController.php:51` (register), `:65` (login), `:123` (token); `config/packages/rate_limiter.yaml:47` (only limiter defined).
**Fix recommendation:** Add per-IP rate limits (plus per-identifier where useful), e.g. login 5/15 min, register 3/hour, token 10/min, returning 429 with `Retry-After`.
**Notes:** Compounds AUTH-09 (timing-based user enumeration); no offline hash-dumping vector found.
**Source:** `01-backend-auth.md` (AUTH-01).

#### AUTH-02 / FE-02 — OAuth login passes access + refresh tokens in the redirect URL
**Severity:** Medium
**Attack scope:** Anyone able to read the web server access log, browser history, or `Referer` headers during the callback round-trip.
**Description:** After a successful OAuth login, the backend redirects the browser to the SPA with both tokens as query parameters — including the 7-day refresh token. The SPA reads them straight from the query string and stores them. The full URL (with both tokens) is written to the web server's access log and is visible in the address bar for the duration of the callback round-trip.
**Affected parts:** `backend/src/Controller/OAuthController.php:106-109` (redirect with `http_build_query(['token' => …, 'refresh_token' => …])`); `frontend/src/pages/AuthCallbackPage.tsx:21-22` (read from `searchParams`), `:33` (store).
**Fix recommendation:** Redirect with a short-lived, single-use **code** instead of tokens and have the SPA exchange it via `POST` (same-origin, tokens in the response body) — mirroring the existing form-encoded refresh-grant pattern. Minimum: drop the access `token` from the redirect and pass the code only.
**Notes:** Found independently by both the backend-auth and frontend audits; consolidated here. Mitigations already in place (verified): all post-store navigations use `{ replace: true }` (token URL does not accumulate in browser history); the SPA makes exactly one same-origin call before navigating away; no third-party resources are loaded; the default referrer policy sends only the origin (no query) to the API host. Residual risk: access logs, the address-bar window, and a JS exception before the `replace` navigation. A leaked refresh token extends the AUTH-04 window (up to 7 days of reuse).
**Source:** `01-backend-auth.md` (AUTH-02) + `03-frontend.md` (FE-02).

#### API-52 — Mapbox budget exhausable by one user; static images and styles/fonts have no per-user isolation
**Severity:** Medium
**Attack scope:** Any authenticated user with a valid JWT (all map endpoints sit behind the `api` firewall). One user's traffic can degrade service for all users.
**Description:** All Mapbox egress is guarded only by *system-wide* rate-limit buckets, not per-user ones. (1) The proxy `MapboxProxyService::callUpstream()` checks `mapbox_proxy_system` (2,500/24h, 13,000/7d, 45,000/30d) **only** for `rate_limited: true` patterns (the tile pattern `^/v4/...`) and **only on a cache miss**; the `^/styles/` and `^/fonts/` patterns are `rate_limited: false` and therefore completely unlimited. (2) Static map images check only the system bucket `mapboxImageSystemLimiter` — there is no per-user limiter. (3) Geocoding is properly scoped (per-user 50/1h plus a 3,000/24h system cap), which makes these endpoints the inconsistent outlier. Consequence: a single authenticated user (or an automated frontend / scripted loop) can exhaust the shared 24h tile/image budget (429s for everyone) and generate unbounded upstream Mapbox spend via `/styles/` and `/fonts/` paths and uncached image parameters — a self-inflicted DoS plus an abuse vector against the organization's Mapbox billing.
**Affected parts:** `backend/src/Service/Map/MapboxProxyService.php:43-45`; `backend/config/services.yaml:12-21` (styles/fonts patterns `rate_limited: false`); `backend/src/Service/Map/RateLimitedMapImageProvider.php:18-26`; `backend/config/packages/rate_limiter.yaml:1-23` (no per-user map/image buckets defined).
**Fix recommendation:** Add per-user buckets keyed on the authenticated user ID (same pattern as `geocode_user`: ~100–200/24h for tiles, ~50/24h for static images), checked in addition to the system buckets. Change `rate_limited: false` to `true` for `^/styles/` and `^/fonts/` — style sheets are large, cached, and still an unbounded upstream cost source if polled. Keep the system buckets as the outer envelope.
**Notes:** 30-day cache TTLs for tiles and static images mitigate most repeated traffic; the risk concentrates on cache misses, cache-busting parameter values, and the two unbounded patterns. The SSRF surface of the proxy itself is sound (see Reviewed & OK).
**Source:** `02b-backend-services.md` (API-52).

### Low

#### AUTH-03 — Account deletion without confirmation, cascading memberships
**Severity:** Low
**Attack scope:** Authenticated user (e.g. via a hijacked session).
**Description:** `DELETE /api/auth/me` requires no re-authentication or confirmation and immediately cascades club memberships (`ClubUser`), passkeys, and linked OAuth accounts.
**Affected parts:** `AuthController.php:175`; `AuthService::deleteMe()`.
**Fix recommendation:** Require re-authentication (password or passkey) or a short-lived confirmation token; consider a soft-delete grace period.
**Notes:** Verified no usable tokens remain after deletion, so the blast radius is the cascade itself, not residual access.
**Source:** `01-backend-auth.md` (AUTH-03).

#### AUTH-04 — Refresh tokens have no rotation or replay detection
**Severity:** Low
**Attack scope:** Attacker who has stolen a refresh token (e.g. via AUTH-02/FE-02).
**Description:** Refresh tokens are 7-day HMAC JWTs with no rotation and no server-side revocation; a stolen token stays usable until expiry, and logout does not invalidate it.
**Affected parts:** `TokenService.php:25-37` (HMAC signing at `:34`); `AuthController.php:134-138` (logout no-op).
**Fix recommendation:** Rotate the refresh token on use (optionally with a short overlap window), or maintain a short-lived revocation store / token families.
**Notes:** Mitigated today by the `tv` session-version kill switch, `uid` binding, and 15-minute access tokens. Related: FE-03 (client-side refresh dedup).
**Source:** `01-backend-auth.md` (AUTH-04).

#### AUTH-05 — Raw exception objects logged with full stack traces
**Severity:** Low
**Attack scope:** Anyone with access to logs / log aggregation; internal structure disclosure.
**Description:** OAuth and WebAuthn error paths log raw exception objects; Monolog renders full stack traces including internal file paths, class names, and framework internals.
**Affected parts:** `OAuthController.php:79, :101`; `WebAuthnService.php:167, :232, :267`.
**Fix recommendation:** Log `$e->getMessage()` plus sanitized context, or add a Monolog processor that strips paths from traces.
**Notes:** HTTP responses are properly masked by `ExceptionListener` (RFC 7807, no traces to clients) — this is a log-side issue only.
**Source:** `01-backend-auth.md` (AUTH-05).

#### API-03 — Unbounded list and bulk-operation endpoints

> **Status (git-log check 2026-10-15): PARTIALLY FIXED** — max 5000 events per import/preview and 5000 ids per bulk request (413 `too_many_events`, `8913ce8`), max 366 events per series (`eacd4d0`). **`listEvents` pagination not confirmed.**
**Severity:** Low
**Attack scope:** Any authenticated member of the calendar's club.
**Description:** `EventService::listEvents` applies no pagination or row limit, so a single request can force a full scan/serialization of every event (and its properties) in a large calendar. Similarly, `createSeriesFromTemplate` accepts an unbounded `$dates` array and `importEvents` an unbounded `$eventsData` array, allowing one request to create an arbitrarily large batch of events.
**Affected parts:** `EventService.php:30-67` (listEvents, no limit), `:77` (createSeriesFromTemplate), `:115` (importEvents).
**Fix recommendation:** Add server-side caps: offset/limit (or cursor) pagination for `listEvents`, and a maximum batch size for `$dates` / `$eventsData` (reject or truncate with a clear 400/422).
**Notes:** All endpoints require `CALENDAR_MEMBER` (plus `NOT_ARCHIVED` on mutators) — resource exhaustion by a legitimate member, not unauthenticated DoS; no data leakage.
**Source:** `02-backend-api.md` (API-03).

#### FE-03 — Access/refresh tokens in `sessionStorage`; no dedup of concurrent refreshes
**Severity:** Low
**Attack scope:** XSS on any page of the SPA; and the API refresh endpoint under a burst of parallel 401s.
**Description:** Tokens are kept in `sessionStorage` (readable by any script running in the tab), so an XSS bug anywhere in the app yields both the access token and the 7-day refresh token (the backend deliberately sets no auth cookies — no httpOnly fallback). In addition, the 401 handler performs an unguarded refresh: every 401 fires its own `POST /api/auth/token`, so several concurrently-expired requests issue parallel refreshes for the same refresh token, racing on the backend.
**Affected parts:** `frontend/src/lib/api.ts:20-26` (storage), `:85-108` (refresh loop).
**Fix recommendation:** The storage choice is an accepted trade-off of the documented stateless-JWT design — keep it, but add a single in-flight refresh promise (dedupe concurrent 401s onto one refresh POST, others await it).
**Notes:** Framed as a trade-off, not a violation. Related: AUTH-04 (server-side rotation would bound the damage of a stolen refresh token).
**Source:** `03-frontend.md` (FE-03).

#### FE-04 — CLI-only `shadcn` package listed as a runtime dependency
**Severity:** Low
**Attack scope:** Supply-chain / maintenance surface; no direct browser exploit.
**Description:** `shadcn ^4.11.0` is a code-generation CLI, not an importable library, and is referenced nowhere in `../../frontend/src`. As a production dependency it is unnecessarily installed into the runtime dependency tree of the SPA.
**Affected parts:** `frontend/package.json:39`.
**Fix recommendation:** Move `shadcn` to `devDependencies` (or drop it).
**Source:** `03-frontend.md` (FE-04).

#### FE-05 — Type-only `@types/mapbox-gl` listed as a runtime dependency
**Severity:** Low
**Attack scope:** None directly (types are erased at build time); supply-chain surface.
**Description:** `@types/mapbox-gl ^3.4.1` contains only TypeScript declarations, is never shipped to the browser, yet sits in `dependencies`, inflating the production install.
**Affected parts:** `frontend/package.json:26`.
**Fix recommendation:** Move to `devDependencies` alongside the other `@types/*` entries.
**Source:** `03-frontend.md` (FE-05).

#### API-53 — Static map image endpoints expose coordinates of calendars the user does not belong to
**Severity:** Low
**Attack scope:** Any authenticated user (valid JWT); only the UUID of the target event or location is required. No club- or calendar-membership check.
**Description:** `GET /api/map/image/location/{id}` and `GET /api/map/image/event/{id}` verify only authentication; there is no `denyAccessUnlessGranted(CalendarMemberVoter::CALENDAR_MEMBER, …)` against the location's or event's calendar. Any logged-in user who knows or guesses a UUID can render a Mapbox static image that reveals the exact coordinates of a location or event in another club's calendar. `Calendar` has no visibility field, so "non-public" here means "belongs to a club the caller is not a member of". The event variant filters drafts, but non-draft events in another club's calendar are still returned. UUIDv7 makes brute force unrealistic, but UUIDs leak into many places (URLs, logs, frontend state), and the `location` variant is the sharper edge because locations have no draft state at all.
**Affected parts:** `backend/src/Controller/MapController.php:100-133` (image and imageEvent actions, no voter checks).
**Fix recommendation:** Load the `Location`/`Event`, resolve its calendar, and enforce `CalendarMemberVoter::CALENDAR_MEMBER` before rendering (plus `NOT_ARCHIVED` if images should also be blocked for archived calendars). Return 404 (not 403) for non-members to avoid confirming UUID existence, mirroring the public feed's behavior.
**Notes:** The geocode routes in the same controller correctly enforce `ROLE_USER` and per-user rate limiting, so the gap is limited to the two image actions. The image response itself exposes no secret — the finding is coordinate leakage.
**Source:** `02b-backend-services.md` (API-53).

#### API-54 — ICS `X-APPLE-STRUCTURED-LOCATION` `X-TITLE` built from unescaped input enables ICS property-line injection
**Severity:** Low
**Attack scope:** Any club member with write access to a calendar. Affects subscribers who import the feed into Apple Calendar / other ICS clients.
**Description:** `IcsService::buildXAppleLine()` hand-builds the `X-APPLE-STRUCTURED-LOCATION` property line and embeds the location's display name directly into the `X-TITLE` parameter without escaping. The address is escaped for embedded newlines, but the title is not. A location name containing `";\r\n` or a raw CRLF can inject additional properties into that line or terminate the parameter list early, corrupting the calendar object or, depending on the parser, injecting extra `VALARM`/`ATTACH`/`URL` properties into all subscribing clients' calendars. The main event body is rendered by `eluceo/ical` (which escapes text values), so only the hand-built Apple line is affected. `X-ADDRESS` shares the same partially escaped value, but its dangerous newline case is already neutralized.
**Affected parts:** `backend/src/Service/IcsService.php:184-212` (`buildXAppleLine()`; `$title` unescaped, `$addr` escapes only `\n`).
**Fix recommendation:** Escape parameter values per RFC 5545 §3.1 (double `"` and replace CRLF with the literal `\n` sequence) for both `$title` and `$addr`, using a small `escapeIcsParamValue` helper. Alternatively, drop `X-TITLE` (Apple falls back to SUMMARY) and keep only the machine-safe `VALUE=URI` GEO portion.
**Notes:** Exploitation requires calendar write access — the attacker is a club member. Impact is calendar corruption/property injection on *other* club members' calendar clients, not data exfiltration. `geo:lat,lon` is sourced from a numeric DB column and is not attacker-controllable text.
**Source:** `02b-backend-services.md` (API-54).

### Informational

#### AUTH-06 — Register: check-then-insert race on the email
**Severity:** Informational
**Attack scope:** Concurrent duplicate registration of the same email.
**Description:** `register()` checks for an existing email and then inserts without a lock. Concurrent duplicates hit the unique index and surface as an unhandled 500 instead of a clean 409. The unique index is the real guarantee — duplicate accounts are impossible.
**Affected parts:** `AuthService.php:30-32`; unique index `users.email`.
**Fix recommendation:** Catch `UniqueConstraintViolationException` on insert and return 400/409.
**Source:** `01-backend-auth.md` (AUTH-06).

#### AUTH-07 — Email verification error redirect leaks the failure reason
**Severity:** Informational
**Attack scope:** Anyone observing the user's post-verification redirect.
**Description:** On failed verification the client is redirected to `?status=error&reason={result}`, exposing the server's failure classification (invalid / expired / already used). No state change on failure; link tokens are single-use.
**Affected parts:** `AuthController.php:111` (verification call), `:117-119` (error redirect).
**Fix recommendation:** Redirect to a generic `?status=error`; keep the specific reason server-side only.
**Source:** `01-backend-auth.md` (AUTH-07).

#### AUTH-08 — WEBAUTHN_USER_VERIFICATION missing from .env.example
**Severity:** Informational
**Attack scope:** Fresh deployments (passkey ceremony with weaker user verification).
**Description:** `services.yaml` wires `WEBAUTHN_USER_VERIFICATION`, but it is commented out in `backend/.env.example`. The code default `preferred` is weaker than `required`.
**Affected parts:** `config/services.yaml:127`; `.env.example:14`; `WebAuthnService.php:71`.
**Fix recommendation:** Set/document the variable in `backend/.env.example` (e.g. `required` for production), or fail fast on missing config.
**Notes:** `required` breaks some platform authenticators; `preferred` is a reasonable floor but should be an explicit choice.
**Source:** `01-backend-auth.md` (AUTH-08).

#### AUTH-09 — Login timing side-channel (user enumeration)
**Severity:** Informational
**Attack scope:** Network attacker performing timing measurements.
**Description:** Login looks up the user by email and only runs password verification for existing users; the not-found path is measurably faster, enabling timing-based enumeration.
**Affected parts:** `AuthService.php:48-54`.
**Fix recommendation:** Always run a dummy credential check on the not-found path (near-constant-time behavior) and/or store a dummy hash per user.
**Notes:** Exploitability is low (network jitter), but it compounds AUTH-01.
**Source:** `01-backend-auth.md` (AUTH-09).

#### AUTH-10 — updateMe accepts unvalidated lastClubId / lastCalendarId

> **Status (git-log check 2026-10-15): PARTIALLY FIXED** — `9451045` validates the types in `PATCH /auth/me`; `223a8d1` moves the last calendar to the membership. Membership of the stored club/calendar is still not verified from the audit's point of view; unverified in code, please re-check.**
**Severity:** Informational
**Attack scope:** Authenticated user (self).
**Description:** `PATCH /api/auth/me` stores `lastClubId` / `lastCalendarId` exactly as sent, without validating that the caller is a member of that club/calendar. They are cosmetic last-visit pointers; no authorization impact found.
**Affected parts:** `AuthController.php:163-164`.
**Fix recommendation:** Validate membership via the existing voters before persisting, or treat the values strictly as untrusted UI hints.
**Source:** `01-backend-auth.md` (AUTH-10).

#### AUTH-11 — UserProvider is an unused stub
**Severity:** Informational
**Attack scope:** None (dead code).
**Description:** `src/Security/UserProvider.php` (33 lines) is not referenced from `security.yaml` or any service wiring; authentication flows through `CurrentUserResolver` instead.
**Affected parts:** `src/Security/UserProvider.php`.
**Fix recommendation:** Remove the stub, or wire it up if intended for future use.
**Source:** `01-backend-auth.md` (AUTH-11).

#### AUTH-12 — JWT signing passphrase equals APP_SECRET
**Severity:** Informational
**Attack scope:** Attacker who obtains the application secret (e.g. env leak).
**Description:** The Lexik JWT passphrase is wired directly to `APP_SECRET`, so one leaked value forges access tokens and compromises everything else the application secret protects.
**Affected parts:** `config/packages/lexik_jwt_authentication.yaml:2, :9`.
**Fix recommendation:** Use a dedicated `JWT_SECRET` env var with independent rotation; do not share secrets across signing domains.
**Source:** `01-backend-auth.md` (AUTH-12).

#### FE-06 — Silent fallback to `http://localhost:3001` when `VITE_API_URL` is unset
**Severity:** Informational
**Attack scope:** Misconfigured deployments; developer ergonomics.
**Description:** `BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001"` — a build produced without the env var compiles fine and silently points all API traffic at localhost instead of failing loudly.
**Affected parts:** `frontend/src/lib/api.ts:4`; `frontend/src/lib/mapboxProxy.ts:1`.
**Fix recommendation:** Fail fast at startup (throw when `VITE_API_URL` is absent in a non-dev build), or log a prominent warning.
**Source:** `03-frontend.md` (FE-06).

#### FE-07 — Dev/build deps lag current major (no vulnerable major in use)
**Severity:** Informational
**Attack scope:** None demonstrated; standard "keep tooling current" hygiene.
**Description:** `vite` is pinned `^6.4.3` (registry latest is 8.x — two majors behind) and `@simplewebauthn/browser` is `^13.3.0` (registry is 14.x). A spot-check of 10 direct dependencies found all *runtime* deps on current majors with only minor bumps. No vulnerable major in use. `vite` is dev-only (build-time), so this is tooling currency, not a runtime risk.
**Affected parts:** `frontend/package.json:65` (`vite`), `:24` (`@simplewebauthn/browser`).
**Fix recommendation:** Bump in a regular maintenance pass; re-run the build and the WebAuthn flow after the WebAuthn bump.
**Source:** `03-frontend.md` (FE-07).

> ⏳ **Pending:** Findings from `04-scans-config.md` (dependencies, secrets, deployment config — numbering `SCAN-xx`) will be inserted into the appropriate sections above when that scan completes.

## Areas Reviewed — no additional findings

**Backend authentication (01)**
- Token flow: 15-min JWT access tokens with a `tv` token-version kill switch; HMAC-signed refresh tokens bound to `uid`, 7-day TTL — sound design (documented gaps: AUTH-04, AUTH-05).
- OAuth SSO: `state` bound to the browser via short-lived one-time `oauth_state_nonce` cookie + PKCE (`code_verifier`/`code_challenge`); the provider response is never sent back to the browser as JSON.
- WebAuthn registration/authentication ceremony follows the spec (challenge binding, `authenticatorAttachment` handling, user verification per `WEBAUTHN_USER_VERIFICATION`).
- `ExceptionListener` masks all exceptions as RFC 7807 `application/problem+json` — no stack traces or entity details reach the client.
- Public route allow-listing in `security.yaml` is explicit and matches the controller mapping.

**Backend API (02)**
- No IDOR or cross-tenant gaps found: every CRUD endpoint resolves entities by UUID and enforces `CALENDAR_MEMBER` / `CLUB_MEMBER` voter checks; nested resources (templates, properties, locations, target groups, features) are scoped to the parent calendar's membership for both reads and writes.
- Nested and calendar-level write endpoints enforce `NOT_ARCHIVED`, and calendar DELETE and duplicate routes enforce it too (archive is now read-only across all write paths).
- Consistent DTO validation via `validateDto()` on all write endpoints; no unvalidated mass assignment observed.

**Backend services (02b)**
- Feed secrets compared in constant time (`hash_equals`) everywhere; unauthenticated public feed access is limited to exactly one feed ID + secret pair.
- Public ICS/JSON feeds for archived calendars return 404 (no metadata leak).
- Mapbox proxy: host restricted to an allowlist, internal/private IP ranges excluded before the request is made — no SSRF path.
- ICS output generated via `eluceo/ical` (header escaping correct); target-group filter only narrows visibility.

**Frontend (03)**
- No live Mapbox token in the SPA working tree (git-history issue only, FE-01).
- OAuth callback clears URL fragments/parameters with `{ replace: true }` before rendering (mitigation for AUTH-02/FE-02); no auth cookies on the frontend.

**Secrets scan (gitleaks)**
- Exactly one genuine hit (FE-01); `gitleaks.json` (not committed: contains the leaked token) evidence fully redacted (0 occurrences of the full token).

## Limitations

- Static, read-only code review: no dynamic testing, no load/rate-limit verification, no WebAuthn attack simulation; line numbers refer to the working tree as of 2026-10-05.
- No nginx/reverse-proxy configuration in the repository → server-side CSP, HSTS, and other transport hardening could not be verified.
- Trivy scanned the Docker image only; the full transitive dependency audit (npm + composer lockfile resolution) is covered by area `04` (pending).
- The Mapbox billing exposure (API-52) is inferred from the API design and rate-limit configuration, not from observed abuse.
- Out of scope: hosting/infrastructure, CI/CD pipelines, secret management outside the repo, and social-engineering/physical threats.

## Appendix A — Findings Index

| ID | Title | Severity |
|---|---|---|
| FE-01 | Mapbox public token leaked in git history | High |
| API-01 | Club membership grants full administrative control (no roles, no last-admin guard) | High |
| AUTH-01 | No rate limiting on login, register, and token refresh | Medium |
| AUTH-02 / FE-02 | OAuth login passes access + refresh tokens in the redirect URL | Medium |
| API-52 | Mapbox budget exhausable by one user; static images and styles/fonts have no per-user isolation | Medium |
| AUTH-03 | Account deletion without confirmation, cascading memberships | Low |
| AUTH-04 | Refresh tokens have no rotation or replay detection | Low |
| AUTH-05 | Raw exception objects logged with full stack traces | Low |
| API-03 | Unbounded list and bulk-operation endpoints | Low |
| FE-03 | Access/refresh tokens in `sessionStorage`; no dedup of concurrent refreshes | Low |
| FE-04 | CLI-only `shadcn` package listed as a runtime dependency | Low |
| FE-05 | Type-only `@types/mapbox-gl` listed as a runtime dependency | Low |
| API-53 | Static map image endpoints expose coordinates of calendars the user does not belong to | Low |
| API-54 | ICS `X-APPLE-STRUCTURED-LOCATION` `X-TITLE` built from unescaped input enables ICS property-line injection | Low |
| AUTH-06 | Register: check-then-insert race on the email | Informational |
| AUTH-07 | Email verification error redirect leaks the failure reason | Informational |
| AUTH-08 | `WEBAUTHN_USER_VERIFICATION` missing from `backend/.env.example` | Informational |
| AUTH-09 | Login timing side-channel (user enumeration) | Informational |
| AUTH-10 | `updateMe` accepts unvalidated `lastClubId` / `lastCalendarId` | Informational |
| AUTH-11 | `UserProvider` is an unused stub | Informational |
| AUTH-12 | JWT signing passphrase equals `APP_SECRET` | Informational |
| FE-06 | Silent fallback to `http://localhost:3001` when `VITE_API_URL` is unset | Informational |
| FE-07 | Dev/build deps lag current major (no vulnerable major in use) | Informational |
| `SCAN-xx` | *(pending — area `04`: dependencies, secrets, deployment config)* | — |

## Appendix B — Per-Area Reports

| Area | Report | Findings | Status |
|---|---|---|---|
| Backend auth | `01-backend-auth.md` | AUTH-01 … AUTH-12 (12) | Complete |
| Backend API (authorization & CRUD) | `02-backend-api.md` | API-01, API-03 (2) | Complete |
| Backend feeds / ICS / map services | `02b-backend-services.md` | API-52 … API-54 (3) | Complete |
| Frontend | `03-frontend.md` | FE-01 … FE-07 (7) | Complete |
| Scans & config | `04-scans-config.md` | `SCAN-xx` | Pending |
| Secrets scan evidence | `gitleaks.json` (not committed: contains the leaked token) | 1 genuine hit (FE-01); redacted in place | Complete |

These reports live in `docs/security-audit/`. The raw `gitleaks.json` evidence is deliberately not committed because it contains the leaked token.
