# Club Calendar — Security Audit Report

**Date:** 2026-10-05
**Status:** Resolved findings have been removed; only open findings remain.

## Scope & Method

| Area | What was reviewed | Report |
|---|---|---|
| Backend auth | `AuthController`, `OAuthController`, `WebAuthnController`; `AuthService`, `TokenService`, `WebAuthnService`, email-verification services; security voters, JWT/security config; auth entities; migrations; `backend/.env.example` | `01-backend-auth.md` |
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
- Counts: **0 High, 1 Medium, 3 Low, 6 Informational** — 10 findings.
- **Top gap:** Mapbox egress is system-rate-limited only, with styles/fonts unlimited (API-52).
- **Positives:** no IDOR/cross-tenant gaps in the API surface; no live Mapbox token in the frontend (fully proxied through the backend); WebAuthn ceremonies, OAuth state handling, and exception → RFC 7807 response masking are sound; feed-secret checks are constant-time and the Mapbox proxy is SSRF-safe (fixed upstream host, strict path allowlist, caller token stripped).

## Findings

### Medium

#### API-52 — Mapbox budget exhausable by one user; static images and styles/fonts have no per-user isolation
**Severity:** Medium
**Attack scope:** Any authenticated user with a valid JWT (all map endpoints sit behind the `api` firewall). One user's traffic can degrade service for all users.
**Description:** All Mapbox egress is guarded only by *system-wide* rate-limit buckets, not per-user ones. (1) The proxy `MapboxProxyService::callUpstream()` checks `mapbox_proxy_system` (2,500/24h, 13,000/7d, 45,000/30d) **only** for `rate_limited: true` patterns (the tile pattern `^/v4/...`) and **only on a cache miss**; the `^/styles/` and `^/fonts/` patterns are `rate_limited: false` and therefore completely unlimited. (2) Static map images check only the system bucket `mapboxImageSystemLimiter` — there is no per-user limiter. (3) Geocoding is properly scoped (per-user 50/1h plus a 3,000/24h system cap), which makes these endpoints the inconsistent outlier. Consequence: a single authenticated user (or an automated frontend / scripted loop) can exhaust the shared 24h tile/image budget (429s for everyone) and generate unbounded upstream Mapbox spend via `/styles/` and `/fonts/` paths and uncached image parameters — a self-inflicted DoS plus an abuse vector against the organization's Mapbox billing.
**Affected parts:** `backend/src/Service/Map/MapboxProxyService.php:43-45`; `backend/config/services.yaml:12-21` (styles/fonts patterns `rate_limited: false`); `backend/src/Service/Map/RateLimitedMapImageProvider.php:18-26`; `backend/config/packages/rate_limiter.yaml:1-23` (no per-user map/image buckets defined).
**Fix recommendation:** Add per-user buckets keyed on the authenticated user ID (same pattern as `geocode_user`: ~100–200/24h for tiles, ~50/24h for static images), checked in addition to the system buckets. Change `rate_limited: false` to `true` for `^/styles/` and `^/fonts/` — style sheets are large, cached, and still an unbounded upstream cost source if polled. Keep the system buckets as the outer envelope.
**Notes:** 30-day cache TTLs for tiles and static images mitigate most repeated traffic; the risk concentrates on cache misses, cache-busting parameter values, and the two unbounded patterns. The SSRF surface of the proxy itself is sound (see Reviewed & OK).
**Source:** `02b-backend-services.md` (API-52).

### Low

#### AUTH-05 — Raw exception objects logged with full stack traces
**Severity:** Low
**Attack scope:** Anyone with access to logs / log aggregation; internal structure disclosure.
**Description:** OAuth and WebAuthn error paths log raw exception objects; Monolog renders full stack traces including internal file paths, class names, and framework internals.
**Affected parts:** `OAuthController.php:79, :101`; `WebAuthnService.php:167, :232, :267`.
**Fix recommendation:** Log `$e->getMessage()` plus sanitized context, or add a Monolog processor that strips paths from traces.
**Notes:** HTTP responses are properly masked by `ExceptionListener` (RFC 7807, no traces to clients) — this is a log-side issue only.
**Source:** `01-backend-auth.md` (AUTH-05).

#### API-53 — Static map image endpoints expose coordinates of calendars the user does not belong to
**Severity:** Low
**Attack scope:** Any authenticated user (valid JWT); only the UUID of the target event or location is required. No club- or calendar-membership check.
**Description:** `GET /api/map/image/location/{id}` and `GET /api/map/image/event/{id}` verify only authentication; there is no `denyAccessUnlessGranted(CalendarMemberVoter::CALENDAR_MEMBER, …)` against the location's or event's calendar. Any logged-in user who knows or guesses a UUID can render a Mapbox static image that reveals the exact coordinates of a location or event in another club's calendar. `Calendar` has no visibility field, so "non-public" here means "belongs to a club the caller is not a member of". The event variant filters drafts, but non-draft events in another club's calendar are still returned. UUIDv7 makes brute force unrealistic, but UUIDs leak into many places (URLs, logs, frontend state), and the `location` variant is the sharper edge because locations have no draft state at all.
**Affected parts:** `backend/src/Controller/MapController.php:100-133` (image and imageEvent actions, no voter checks).
**Fix recommendation:** Load the `Location`/`Event`, resolve its calendar, and enforce `CalendarMemberVoter::CALENDAR_MEMBER` before rendering (plus `NOT_ARCHIVED` if images should also be blocked for archived calendars). Return 404 (not 403) for non-members to avoid confirming UUID existence, mirroring the public feed's behavior.
**Notes:** The geocode routes in the same controller correctly enforce `ROLE_USER` and per-user rate limiting, so the gap is limited to the two image actions. The image response itself exposes no secret — the finding is coordinate leakage.
**Source:** `02b-backend-services.md` (API-53).

#### AUTH-13 — SSO login code is not bound to the browser that started the flow (login CSRF)
**Severity:** Low
**Attack scope:** Attacker who can make a victim open a crafted link within the code lifetime (default 180 s, env `OAUTH_LOGIN_CODE_TTL`).
**Description:** The one-time code at `/auth/callback?code=…` is minted after the provider callback (the OAuth `state` is bound to the browser by the `oauth_state_nonce` cookie), but the code itself is not bound to that browser: an attacker completes their own SSO flow, stops at the callback URL and sends the link to the victim, whose SPA then signs in as the attacker. This is the same exposure as the former token URLs, not a regression.
**Affected parts:** `backend/src/Controller/OAuthController.php` (callback redirect); `backend/src/Security/OneTimeTokenService.php`; `frontend/src/pages/AuthCallbackPage.tsx`.
**Fix recommendation:** Include a hash of the state nonce in the code's claims and require a matching short-lived HttpOnly cookie at `POST /api/auth/token`. The cookie path must cover `/api/auth/token`; the current nonce cookie path is `/api/auth/oauth` and the callback deletes it.
**Notes:** Residual risk found while verifying the one-time-code hand-over that replaced the token redirect.

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
**Notes:** Exploitability is low (network jitter).
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
- Token flow: 15-min JWT access tokens with a `tv` token-version kill switch; HMAC-signed refresh tokens bound to `uid`, 7-day TTL — sound design (documented gap: AUTH-05).
- OAuth SSO: `state` bound to the browser via short-lived one-time `oauth_state_nonce` cookie + PKCE (`code_verifier`/`code_challenge`); the provider response is never sent back to the browser as JSON.
- WebAuthn registration/authentication ceremony follows the spec (challenge binding, `authenticatorAttachment` handling, user verification per `WEBAUTHN_USER_VERIFICATION`).
- `ExceptionListener` masks all exceptions as RFC 7807 `application/problem+json` — no stack traces or entity details reach the client.
- Public route allow-listing in `security.yaml` is explicit and matches the controller mapping.

**Backend API**
- No IDOR or cross-tenant gaps found: every CRUD endpoint resolves entities by UUID and enforces `CALENDAR_MEMBER` / `CLUB_MEMBER` voter checks; nested resources (templates, properties, locations, target groups, features) are scoped to the parent calendar's membership for both reads and writes.
- Nested and calendar-level write endpoints enforce `NOT_ARCHIVED`, and calendar DELETE and duplicate routes enforce it too (archive is now read-only across all write paths).
- Consistent DTO validation via `validateDto()` on all write endpoints; no unvalidated mass assignment observed.

**Backend services (02b)**
- Feed secrets compared in constant time (`hash_equals`) everywhere; unauthenticated public feed access is limited to exactly one feed ID + secret pair.
- Public ICS/JSON feeds for archived calendars return 404 (no metadata leak).
- Mapbox proxy: host restricted to an allowlist, internal/private IP ranges excluded before the request is made — no SSRF path.
- ICS output generated via `eluceo/ical` (header escaping correct); target-group filter only narrows visibility.

**Frontend (03)**
- No live Mapbox token in the SPA working tree.
- OAuth callback clears URL fragments/parameters with `{ replace: true }` before rendering; no auth cookies on the frontend.

**Secrets scan (gitleaks)**
- Secrets scan clean (rotated Mapbox tokens addressed).

## Limitations

- Static, read-only code review: no dynamic testing, no load/rate-limit verification, no WebAuthn attack simulation; line numbers refer to the working tree as of 2026-10-05.
- No nginx/reverse-proxy configuration in the repository → server-side CSP, HSTS, and other transport hardening could not be verified.
- Trivy scanned the Docker image only; the full transitive dependency audit (npm + composer lockfile resolution) is covered by area `04` (pending).
- The Mapbox billing exposure (API-52) is inferred from the API design and rate-limit configuration, not from observed abuse.
- Out of scope: hosting/infrastructure, CI/CD pipelines, secret management outside the repo, and social-engineering/physical threats.

## Appendix A — Findings Index

| ID | Title | Severity |
|---|---|---|
| API-52 | Mapbox budget exhausable by one user; static images and styles/fonts have no per-user isolation | Medium |
| AUTH-05 | Raw exception objects logged with full stack traces | Low |
| API-53 | Static map image endpoints expose coordinates of calendars the user does not belong to | Low |
| AUTH-13 | SSO login code is not bound to the browser that started the flow (login CSRF) | Low |
| AUTH-06 | Register: check-then-insert race on the email | Informational |
| AUTH-07 | Email verification error redirect leaks the failure reason | Informational |
| AUTH-08 | `WEBAUTHN_USER_VERIFICATION` missing from `backend/.env.example` | Informational |
| AUTH-09 | Login timing side-channel (user enumeration) | Informational |
| AUTH-10 | `updateMe` accepts unvalidated `lastClubId` / `lastCalendarId` | Informational |
| AUTH-11 | `UserProvider` is an unused stub | Informational |
| AUTH-12 | JWT signing passphrase equals `APP_SECRET` | Informational |
| FE-07 | Dev/build deps lag current major (no vulnerable major in use) | Informational |

## Appendix B — Per-Area Reports

| Area | Report | Findings | Status |
|---|---|---|---|
| Backend auth | `01-backend-auth.md` | AUTH-05, AUTH-08 … AUTH-13 (7) | Complete |
| Backend feeds / ICS / map services | `02b-backend-services.md` | API-52 … API-53 (2) | Complete |
| Frontend | `03-frontend.md` | FE-07 (1) | Complete |
| Scans & config | `04-scans-config.md` | SCAN-04, SCAN-07, SCAN-09, SCAN-10, SCAN-12 (5) | Complete |

These reports live in `docs/security-audit/`.
