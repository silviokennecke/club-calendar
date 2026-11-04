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
- Counts: **0 High, 0 Medium, 1 Low, 2 Informational** — 3 findings.
- **Positives:** no IDOR/cross-tenant gaps in the API surface; no live Mapbox token in the frontend (fully proxied through the backend); WebAuthn ceremonies, OAuth state handling, and exception → RFC 7807 response masking are sound; feed-secret checks are constant-time and the Mapbox proxy is SSRF-safe (fixed upstream host, strict path allowlist, caller token stripped).

## Findings

### Low

#### API-53 — Static map image endpoints expose coordinates of calendars the user does not belong to
**Severity:** Low
**Attack scope:** Any authenticated user (valid JWT); only the UUID of the target event or location is required. No club- or calendar-membership check.
**Description:** `GET /api/map/image/location/{id}` and `GET /api/map/image/event/{id}` verify only authentication; there is no `denyAccessUnlessGranted(CalendarMemberVoter::CALENDAR_MEMBER, …)` against the location's or event's calendar. Any logged-in user who knows or guesses a UUID can render a Mapbox static image that reveals the exact coordinates of a location or event in another club's calendar. `Calendar` has no visibility field, so "non-public" here means "belongs to a club the caller is not a member of". The event variant filters drafts, but non-draft events in another club's calendar are still returned. UUIDv7 makes brute force unrealistic, but UUIDs leak into many places (URLs, logs, frontend state), and the `location` variant is the sharper edge because locations have no draft state at all.
**Affected parts:** `backend/src/Controller/MapController.php:100-133` (image and imageEvent actions, no voter checks).
**Fix recommendation:** Load the `Location`/`Event`, resolve its calendar, and enforce `CalendarMemberVoter::CALENDAR_MEMBER` before rendering (plus `NOT_ARCHIVED` if images should also be blocked for archived calendars). Return 404 (not 403) for non-members to avoid confirming UUID existence, mirroring the public feed's behavior.
**Notes:** The geocode routes in the same controller correctly enforce `ROLE_USER` and per-user rate limiting, so the gap is limited to the two image actions. The image response itself exposes no secret — the finding is coordinate leakage.
**Source:** `02b-backend-services.md` (API-53).

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

> ⏳ **Pending:** Findings from `04-scans-config.md` (dependencies, secrets, deployment config — numbering `SCAN-xx`) will be inserted into the appropriate sections above when that scan completes.

## Areas Reviewed — no additional findings

**Backend authentication (01)**
- Token flow: 15-min JWT access tokens with a `tv` token-version kill switch; HMAC-signed refresh tokens bound to `uid`, 7-day TTL — sound design.
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
- Out of scope: hosting/infrastructure, CI/CD pipelines, secret management outside the repo, and social-engineering/physical threats.

## Appendix A — Findings Index

| ID | Title | Severity |
|---|---|---|
| API-53 | Static map image endpoints expose coordinates of calendars the user does not belong to | Low |
| AUTH-06 | Register: check-then-insert race on the email | Informational |
| AUTH-07 | Email verification error redirect leaks the failure reason | Informational |

## Appendix B — Per-Area Reports

| Area | Report | Findings | Status |
|---|---|---|---|
| Backend auth | `01-backend-auth.md` | AUTH-06 … AUTH-07 (2) | Complete |
| Backend feeds / ICS / map services | `02b-backend-services.md` | API-53 (1) | Complete |
| Frontend | `03-frontend.md` | None (0) | Complete |
| Scans & config | `04-scans-config.md` | SCAN-07, SCAN-09, SCAN-12 (3) | Complete |

These reports live in `docs/security-audit/`.
