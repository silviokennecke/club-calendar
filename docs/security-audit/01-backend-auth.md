# Backend Auth Security Audit

## Scope

Backend authentication and account management of the Symfony 8.1 API (`backend/`):

- `src/Controller/AuthController.php`, `OAuthController.php`, `WebAuthnController.php`
- `src/Service/AuthService.php`, `TokenService.php`, `WebAuthnService.php`, `EmailVerificationService.php`, `EmailVerificationMailer.php`
- `src/Security/CurrentUserResolver.php`, `SessionVersionListener.php`, security voters; `src/EventListener/ExceptionListener.php`; `src/OAuth/OidcResourceOwner.php`
- Entities: `User`, `Passkey`, `OAuthAccount`, `EmailVerification`, `AuthNonce`
- `config/packages/security.yaml`, `lexik_jwt_authentication.yaml`, `knpu_oauth2_client.yaml`, `rate_limiter.yaml`, `monolog.yaml`, `services.yaml`; `migrations/`; `.env.example`

Out of scope: frontend application, hosting/infrastructure, non-auth API modules.

## Method

Static, read-only code review: full reads of every in-scope file plus targeted re-reads to confirm exact behavior and line numbers. Each candidate finding was verified against the actual code path before inclusion; false positives were dropped. Severity scale: Critical / High / Medium / Low / Informational. Secrets are referenced by name only.

## Date

2026-10-05

### AUTH-05 — Raw exception objects logged with full stack traces
**Severity:** Low
**Attack scope:** Anyone with access to logs / log aggregation; internal structure disclosure
**Description:** OAuth and WebAuthn error paths log raw exception objects; Monolog renders full stack traces including internal file paths, class names, and framework internals.
**Affected parts:** `OAuthController.php:79, :101`; `WebAuthnService.php:167, :232, :267`
**Fix recommendation:** Log `$e->getMessage()` plus sanitized context, or add a Monolog processor that strips paths from traces.
**Notes:** HTTP responses are properly masked by ExceptionListener (RFC 7807, no traces to clients) — this is log-side only.

### AUTH-06 — Register: check-then-insert race on email
**Severity:** Informational
**Attack scope:** Concurrent duplicate registration of the same email
**Description:** `register()` checks for an existing email and then inserts without a lock; concurrent duplicates hit the unique index and surface as an unhandled 500 instead of a clean 409.
**Affected parts:** `AuthService.php:30-32`; unique index `users.email` (`migrations/Version20260625000000.php:28`)
**Fix recommendation:** Catch `UniqueConstraintViolationException` on insert and return 400/409.
**Notes:** The unique index is the real guarantee — duplicate accounts are impossible; this is a robustness/UX issue.

### AUTH-07 — Email-verification error redirect leaks the failure reason
**Severity:** Informational
**Attack scope:** Anyone who can observe the user's post-verification redirect
**Description:** On failed verification the client is redirected to `?status=error&reason={result}`, exposing the server's failure classification (invalid / expired / already used) to the client.
**Affected parts:** `AuthController.php:111` (verify call), `:117-119` (error redirect)
**Fix recommendation:** Redirect to a generic `?status=error`; keep the specific reason server-side only.
**Notes:** No state change on failure; link tokens are single-use, so the leak is informational.

### AUTH-08 — WEBAUTHN_USER_VERIFICATION missing from .env.example
**Severity:** Informational
**Attack scope:** Fresh deployments (passkey ceremonies with weaker user verification)
**Description:** `services.yaml` wires `WEBAUTHN_USER_VERIFICATION`, but it is commented out in `.env.example`; the code default `preferred` is weaker than `required`.
**Affected parts:** `config/services.yaml:127`; `.env.example:14`; `WebAuthnService.php:71`
**Fix recommendation:** Set/document the variable in `.env.example` (e.g. `required` for production) or fail fast on missing configuration.
**Notes:** `required` breaks some platform authenticators; `preferred` is a reasonable floor but should be an explicit choice.

### AUTH-09 — Login timing side-channel and collation-normalized email lookup
**Severity:** Informational
**Attack scope:** Network attacker performing timing measurements; user enumeration
**Description:** Login looks the user up by email (collation-normalized) and runs password verification only for existing users; the not-found path is measurably faster, enabling timing-based enumeration.
**Affected parts:** `AuthService.php:48-54`
**Fix recommendation:** Always run a dummy credential check on the not-found path (constant-time-ish behavior) and/or store a per-user dummy hash.
**Notes:** Exploitability is low (network jitter).

### AUTH-10 — updateMe accepts unvalidated lastClubId / lastCalendarId

> **Status (git-log check 2026-10-15): PARTIALLY FIXED** — `9451045` validates the types in `PATCH /auth/me`; `223a8d1` moves the last calendar to the membership. Membership of the stored club/calendar is still not verified from the audit's point of view; unverified in code, please re-check.**
**Severity:** Informational
**Attack scope:** Authenticated user (self)
**Description:** `PATCH /api/auth/me` stores `lastClubId` / `lastCalendarId` exactly as sent, without validating that the caller is a member of that club/calendar.
**Affected parts:** `AuthController.php:163-164`
**Fix recommendation:** Validate membership via the existing voters before persisting, or treat the values strictly as untrusted UI hints.
**Notes:** Cosmetic last-visit pointers; no authorization impact found.

### AUTH-11 — UserProvider is an unused stub
**Severity:** Informational
**Attack scope:** None (dead code)
**Description:** `src/Security/UserProvider.php` (33 lines) is not referenced from `security.yaml` or any service wiring; authentication flows through `CurrentUserResolver` instead.
**Affected parts:** `src/Security/UserProvider.php`
**Fix recommendation:** Remove the stub, or wire it up if intended for future use.
**Notes:** Dead security-adjacent code is a maintenance/confusion risk, not a vulnerability.

### AUTH-12 — JWT signing passphrase equals APP_SECRET
**Severity:** Informational
**Attack scope:** Attacker who obtains the application secret (e.g. environment leak)
**Description:** The Lexik JWT passphrase is wired directly to `APP_SECRET`, so one leaked value forges access tokens and compromises everything else the application secret protects.
**Affected parts:** `config/packages/lexik_jwt_authentication.yaml:2, :9`
**Fix recommendation:** Use a dedicated `JWT_SECRET` environment variable with independent rotation; do not share secrets across signing domains.
**Notes:** Not exploitable on its own; a defense-in-depth / key-management issue.

## Reviewed & OK

- **Email verification:** register sends the initial verification email (`AuthService.php:43`); login blocks unverified users (`AuthService.php:55-57`, `EmailNotVerifiedException`); the public resend endpoint is rate-limited (`email_verification_resend`) and answers with a uniform 204 regardless of email existence (no enumeration) (`AuthController.php:90-103`); the stored token is bcrypt-hashed, link tokens are single-use.
- **Logout:** now revokes the refresh token family server-side (`POST /api/auth/logout`, idempotent and uniform); `POST /api/auth/logout-all` additionally bumps the token version and revokes all families.
- **Exception handling:** `ExceptionListener` converts every exception to RFC 7807 `application/problem+json`; no stack traces or internal paths in responses; sensitive fields masked (`ExceptionListener.php:72-81`).
- **OAuth login CSRF:** state is HMAC-signed and bound to purpose + provider (TTL 600 s); the `oauth_state_nonce` cookie is HttpOnly/Secure, compared via `hash_equals`, single-use via `NonceStore`; `SameSite=None` handled (required for Apple); `use_state: false` on the client is intentional given the custom state handling (`OAuthController.php:141-151`).
- **OAuth account linking:** verified emails only are accepted (`OidcResourceOwner.php:29-34`); email match via `strcasecmp` (`AuthService.php:195`); unproven local credentials are revoked on link (`AuthService.php:224-244`).
- **WebAuthn:** fresh random challenge per ceremony (`WebAuthnService.php:93`); HMAC-signed `challengeToken` (`:95-99`); single-use nonces; strict origin check (`:314`); signature counter enforced (`:88`); uniform 401 on any authentication failure (`:288-291`); passkey deletion ownership-checked (`:281`); constant-time compare (`:171`); webauthn-lib ^5.3.5.
- **Refresh tokens:** `sub` = UUID plus `uid` binding prevents reuse after delete-and-recreate; `decodeRefreshToken` verifies raw HMAC-SHA256 + `hash_equals` + expiry with no algorithm parsing; missing `uid`/`tv` treated as documented legacy version 0 (`TokenService.php:60-61`).
- **Session handling:** `SessionVersionListener` checks the session version per request (server-side kill switch via `tv`); `SignedTokenService` issues purpose-bound HMAC tokens with expiry; `NonceStore` is cross-process single-use with UTC + 60 s clock-skew buffer; `CurrentUserResolver` returns 401 when the user no longer exists.
- **Logging:** production Monolog is `fingers_crossed` → stderr; no token values logged anywhere in the auth paths.
- **Database:** unique constraints back every identity guarantee — `users.email` (`Version20260625000000.php:28`), `passkey.credential_id` (`:231`), oauth `(provider, provider_id)` (`:243`), `auth_nonce_hash` (`Version20261004120000.php:23`).
- **Test config:** the plaintext password hasher is scoped to the test environment only (`security.yaml:31-35`).
