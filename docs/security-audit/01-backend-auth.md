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

Static, read-only code review: full reads of every in-scope file plus targeted re-reads to confirm exact behavior and line numbers. Line numbers of the original audit were dropped (they had drifted). Each candidate finding was verified against the actual code path before inclusion; false positives were dropped. Severity scale: Critical / High / Medium / Low / Informational. Secrets are referenced by name only.

## Date

2026-10-05

No open findings in this area report. AUTH-06 (register race) is fixed (`AuthService.php:78-81` answers 400 `email_taken` on the unique-index violation, `RegisterRaceTest`). AUTH-07 (failure reason in the verification redirect) is accepted as wanted behaviour (`docs/ops/BACKLOG.md`). Hardening notes for this area: I3 in `AUDIT-2026-10-06.md`.

## Reviewed & OK

- **Email verification:** by a 6-digit code (bcrypt-hashed, 15 min, single use, 5 attempts) confirmed by `POST /api/auth/verify-email` in a restricted session: registration, login and refresh of an unverified user return a token pair that `EmailVerificationGateListener` limits to the confirmation routes (403 `email_verification_required`); the resend endpoint (`POST /api/auth/resend-verification`) needs that session and is rate-limited per account (5 min) and per IP. No verification link exists.
- **Logout:** now revokes the refresh token family server-side (`POST /api/auth/logout`, idempotent and uniform); `POST /api/auth/logout-all` additionally bumps the token version and revokes all families.
- **Exception handling:** `ExceptionListener` converts every exception to RFC 7807 `application/problem+json`; no stack traces or internal paths in responses; sensitive fields masked.
- **OAuth login CSRF:** state is HMAC-signed and bound to purpose + provider (TTL 600 s); the `oauth_state_nonce` cookie is HttpOnly/Secure, compared via `hash_equals`, single-use via `NonceStore`; the cookie is `Secure; HttpOnly; SameSite=None`, path `/api/auth/oauth` (`OAuthController::stateCookie`): None because Apple returns with a cross-site `form_post` that drops Lax cookies; `use_state: false` on the client is intentional given the custom state handling.
- **OAuth account linking:** verified emails only are accepted; email match via `strcasecmp`; unproven local credentials are revoked on link.
- **WebAuthn:** fresh random challenge per ceremony; HMAC-signed `challengeToken`; single-use nonces; strict origin check; signature counter enforced; uniform 401 on any authentication failure; passkey deletion ownership-checked; constant-time compare; webauthn-lib ^5.3.5.
- **Refresh tokens:** `sub` = UUID plus `uid` binding prevents reuse after delete-and-recreate; the refresh token is a hand-built HS256 JWT-shaped string (standard base64, not base64url, `TokenService.php:70-74`); `decodeRefreshToken` verifies the raw HMAC-SHA256 over `header.body` with `hash_equals` and expiry, ignoring the header's `alg` (`:84-100`); missing `uid`/`tv` treated as documented legacy version 0.
- **Session handling:** `SessionVersionListener` checks the session version per request (server-side kill switch via `tv`); `SignedTokenService` issues purpose-bound HMAC tokens with expiry; `NonceStore` is cross-process single-use with UTC + 60 s clock-skew buffer; `CurrentUserResolver` returns 401 when the user no longer exists.
- **Logging:** production Monolog is `fingers_crossed` → stderr; no token values logged anywhere in the auth paths.
- **Database:** unique constraints back every identity guarantee — `users.email` (`Version20260625000000.php`), `passkey.credential_id`, oauth `(provider, provider_id)`, `auth_nonce_hash` (`Version20261004120000.php`).
- **Test config:** weaker password hashing (bcrypt cost 5 / 4) is scoped to the test environment only (`when@test` in `security.yaml`); there is no plaintext hasher.
