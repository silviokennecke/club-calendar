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

### AUTH-08 — WEBAUTHN_USER_VERIFICATION missing from .env.example
**Severity:** Informational
**Attack scope:** Fresh deployments (passkey ceremonies with weaker user verification)
**Description:** `services.yaml` wires `WEBAUTHN_USER_VERIFICATION`, but it is commented out in `.env.example`; the code default `preferred` is weaker than `required`.
**Affected parts:** `config/services.yaml:127`; `.env.example:14`; `WebAuthnService.php:71`
**Fix recommendation:** Set/document the variable in `.env.example` (e.g. `required` for production) or fail fast on missing configuration.
**Notes:** `required` breaks some platform authenticators; `preferred` is a reasonable floor but should be an explicit choice.

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
