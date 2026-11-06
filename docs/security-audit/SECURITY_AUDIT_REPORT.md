# Club Calendar — Security Audit Report

**Date:** 2026-10-05
**Status:** Resolved findings have been removed; only open findings remain. Re-verified against the code on branch `security/audit-followup` on 2026-11-06. The open items are listed in `docs/ops/BACKLOG.md` ("Offene Sicherheitsrisiken"); this report and `AUDIT-2026-10-06.md` hold the details.

## Scope & Method

| Area | What was reviewed | Report |
|---|---|---|
| Backend auth | `AuthController`, `OAuthController`, `WebAuthnController`; `AuthService`, `TokenService`, `WebAuthnService`, email-verification services; security voters, JWT/security config; auth entities; migrations; `backend/.env.example` | `01-backend-auth.md` |
| Backend feeds/ICS/map services | `FeedService`, `PublicFeedService`, `IcsService`, `src/Service/Map/` (Mapbox proxy, map images, geocoding), `Feed` entity | `02b-backend-services.md` |
| Frontend | React SPA (Vite, React 19, TanStack Query), auth storage, OAuth callback, Mapbox proxy client, dependency spot-check | `03-frontend.md` |
| Scans & config | gitleaks (git history, project `.gitleaks.toml`), Trivy (Docker), dependency spot-checks (npm/composer), `../../docker-compose.yml`, service/env wiring | `04-scans-config.md` |

**Method:** Static, read-only code review (full reads of in-scope files, grep-first for known sink/pattern classes, targeted re-reads to verify exact behavior and line numbers) plus automated scans. Every finding was verified against the actual code path before inclusion; false positives were dropped. The audit itself changed no code; fixes landed afterwards and were removed from the documents. Secret values are never printed; they are referenced by name or a redacted placeholder.

## Severity Scale

| Level | Meaning |
|---|---|
| **Critical** | Actively exploitable: data breach, full account takeover, remote code execution |
| **High** | Realistic attack with significant impact (admin via a single compromised account, leaked credentials) |
| **Medium** | Exploitable under common conditions, or meaningful weakening of a security control |
| **Low** | Limited impact, requires a precondition (valid account, log access), or robustness issue |
| **Informational** | Hygiene/hardening notes; no direct vulnerability |

## Executive Summary

- **No Critical findings.**
- Counts (open, both audit documents together): **0 High, 0 Medium, 1 Low, 3 Informational** — 4 findings. Detailed here: API-53. Detailed in `AUDIT-2026-10-06.md`: I3, I4, SCAN-12 (residual).
- **Positives:** club- and calendar-scoped CRUD controllers carry voter checks and body-supplied reference ids are scope-checked (`CalendarReferences`); the one gap in the id-in-path surface is API-53; no Mapbox token in the frontend working tree (fully proxied through the backend; a token-shaped value remains in git history, see Secrets scan); WebAuthn ceremonies, OAuth state handling, and exception → RFC 7807 response masking are sound; feed-secret checks are constant-time and the Mapbox proxy is SSRF-safe (fixed upstream host, strict path allowlist, caller token replaced).

## Findings

### Low

#### API-53 — Static map image endpoints are public and not bound to feed access (merges former L5)
**Severity:** Low
**Attack scope:** Unauthenticated. `/api/map/image/` is `PUBLIC_ACCESS` (`security.yaml:60`, deliberately: anonymous feed pages show these images). Only the UUID of a location or event is required.
**Description:** `GET /api/map/image/location/{id}` and `GET /api/map/image/event/{id}` check no authentication and no membership, and do not check that the location or event is published in any feed. They return a Mapbox static image centred on the coordinates, from which the position can be read; no other data. Location variant: any location with coordinates, including ones no feed shows. Event variant: any non-draft event, including events of archived calendars or of calendars without a feed. UUIDv7 makes guessing unrealistic, but ids of published events and their locations appear in public feed output and ids leak into URLs, logs and frontend state.
**Residual cost exposure:** a per-IP limit exists (`map_image_ip`, 360/h, API-52, `3775870`). The shared Mapbox image budget (`mapbox_image_daily|weekly|monthly`, 2500/13000/45000) is consumed on cache misses only and stays shared: many IPs requesting many distinct known coordinates could still exhaust it, after which map images answer 429 for everybody. Not tested dynamically.
**Affected parts:** `backend/src/Controller/MapController.php:106-129` (`locationImage`, `eventImage`: IP limit only, no ownership or publication check), `backend/config/packages/security.yaml:60`.
**Fix recommendation:** Bind the image to what the caller may see: feed-scoped or signed URLs for anonymous pages, a member check for the signed-in app; 404 (not 403) otherwise.
**Notes:** The geocode routes in the same controller require `ROLE_USER` and are rate-limited per user. `/api/mapbox/` (tiles, styles, fonts) requires a signed-in user (`security.yaml:50`).
**Source:** `02b-backend-services.md` (API-53), `AUDIT-2026-10-06.md` (former L5, AUTHZ-F7).

## Areas Reviewed — no additional findings

**Backend authentication (01)**
- Token flow: 15-min JWT access tokens with a `tv` token-version kill switch; HMAC-signed refresh tokens bound to `uid`, 7-day TTL — sound design.
- OAuth SSO: `state` is HMAC-signed and bound to the browser via the short-lived one-time `oauth_state_nonce` cookie (HttpOnly, Secure, `SameSite=None`, path `/api/auth/oauth`; None because Apple returns with a cross-site `form_post`); the one-time login code is bound to the starting tab by a PKCE-style `code_verifier`/`code_challenge` (S256, L13). There is no PKCE towards the identity provider (`OidcProvider`, see I3 in `AUDIT-2026-10-06.md`). The provider response is never sent back to the browser as JSON.
- WebAuthn registration/authentication ceremony follows the spec (challenge binding, `authenticatorAttachment` handling, user verification per `WEBAUTHN_USER_VERIFICATION`).
- `ExceptionListener` masks all exceptions as RFC 7807 `application/problem+json` — no stack traces or entity details reach the client.
- Public route allow-listing in `security.yaml` is explicit and matches the controller mapping.

**Backend API**
- Club- and calendar-scoped CRUD controllers enforce `CalendarMemberVoter` / `ClubMemberVoter` checks, and ids in request bodies (locations, target groups, properties, features, templates, feed calendars, holiday calendars, bulk ids) are resolved within the parent club or calendar (`CalendarReferences`, 422 `unknown_reference`). The exception found is API-53 (public map images by id). Existence of a club or calendar id is observable (404 unknown vs 403 non-member, I3).
- Nested and calendar-level write endpoints enforce `NOT_ARCHIVED`, and calendar DELETE and duplicate routes enforce it too (archive is now read-only across all write paths).
- Consistent DTO validation via `validateDto()` on all write endpoints; no unvalidated mass assignment observed.

**Backend services (02b)**
- Feed secrets compared in constant time (`hash_equals`) everywhere; unauthenticated public feed access is limited to exactly one feed ID + secret pair.
- Public ICS/JSON feeds for archived calendars return 404 (no metadata leak).
- Mapbox proxy: fixed upstream host `api.mapbox.com`, path allowlist (`mapbox.allowed_patterns` in `services.yaml`), dot segments and backslashes rejected after iterative decoding, caller `access_token` replaced by the server token — no SSRF path.
- ICS output generated via `eluceo/ical` (header escaping correct); target-group filter only narrows visibility.

**Frontend (03)**
- No Mapbox token in the SPA working tree (`mapboxProxy.ts` sets the dummy `pk.proxy`).
- OAuth callback clears URL fragments/parameters with `{ replace: true }` before rendering; no auth cookies on the frontend.

**Secrets scan (gitleaks)**
- Re-run on 2026-11-05 (665 commits, project `.gitleaks.toml`): 1 finding, a Mapbox public-token-shaped value in the history (commit `e0bbc0a`, `MapPicker.tsx`, since deleted); none in the working tree. Whether the token was rotated cannot be verified from the repository.

## Limitations

- Static, read-only code review: no dynamic testing, no load/rate-limit verification, no WebAuthn attack simulation; line numbers refer to the working tree as of 2026-10-05.
- The security headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`, COOP, `Referrer-Policy`) are set in `backend/public/.htaccess` and `docker/Caddyfile`; the two are checked for identity by `SecurityHeadersConfigTest`. What a given deployment actually sends was not verified. HSTS is conditional in `.htaccess` and not set by Caddy; by decision the TLS terminator in front of it sends it (`docs/ops/BACKLOG.md`); an nginx configuration is only documented in `docs/ops/OPERATIONS.md`.
- Dependency audits: `npm audit` was re-run on 2026-11-05, `composer audit` is clean on 2026-11-06 after the update to 8.1.11, see `04-scans-config.md`. Trivy and semgrep were not re-run (not installed).
- Out of scope: hosting/infrastructure, CI/CD pipelines, secret management outside the repo, and social-engineering/physical threats.

## Appendix A — Findings Index

| ID | Title | Severity | Detail |
|---|---|---|---|
| API-53 | Static map image endpoints are public and not bound to feed access (former L5) | Low | this report |
| I3 | Misc backend hardening notes | Informational | `AUDIT-2026-10-06.md` |
| I4 | Frontend hardening notes | Informational | `AUDIT-2026-10-06.md` |
| SCAN-12 | CI: release `ci` call keeps `contents: write` (residual) | Informational | `04-scans-config.md`, `AUDIT-2026-10-06.md` |

## Appendix B — Per-Area Reports

| Area | Report | Open findings | Status |
|---|---|---|---|
| Backend auth | `01-backend-auth.md` | None in the area report (I3 items in `AUDIT-2026-10-06.md`) | Complete |
| Backend feeds / ICS / map services | `02b-backend-services.md` | API-53 (1) | Complete |
| Frontend | `03-frontend.md` | None in the area report (I4 in `AUDIT-2026-10-06.md`) | Complete |
| Scans & config | `04-scans-config.md` | SCAN-12 residual (1) | Complete |

These reports live in `docs/security-audit/`.
