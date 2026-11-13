# Changelog

All notable changes to this project are documented in this file, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and are released as git tags `vX.Y.Z`.

## [Unreleased]

### Added

- **Job queue and scheduler:** all e-mail is sent through a queue (Symfony Messenger on the application database, bodies encrypted with `APP_SECRET`, 3 retries, then a `failed` queue; inspect with `messenger:failed:show`) and all periodic jobs (pruning, holiday refresh, GeoIP update) run through the built-in scheduler at fixed UTC times. New settings `MESSENGER_TRANSPORT_DSN`, `SCHEDULER_ENABLED`, `LOCK_DSN`; new command `app:prune-failed-messages` (failed queue rows older than 30 days, daily); new tables `messenger_messages`, `lock_keys`, `cache_items` (migrations run automatically).
- **Docker roles and supervisord:** the image runs supervisord (as `www-data`) with `ROLE=all` (default), `web` or `worker`; `MESSENGER_WORKERS` (default 2) sets the number of queue workers, `MIGRATION_WAIT_RETRIES` how long a worker waits for migrations. A crash of PHP-FPM, Caddy or a program ends the container so the orchestrator restarts it; the health check covers all roles. Recommended `stop_grace_period: 90s`.
- **Redis/Valkey cache (optional):** `CACHE_DSN` (`redis://`, `rediss://`, `valkey://`, `valkeys://`) and `CACHE_PREFIX` move rate limits, MCP sessions and the app caches to a shared Redis so several containers share them; default stays the filesystem. The Docker image includes the `redis` PHP extension. If Redis is unreachable, rate limits are not enforced.
- **File storage (optional):** `STORAGE_SOURCE` (`storage.local` or `storage.s3`), `STORAGE_LOCAL_PATH` (image: `/data/storage`), `S3_*` settings and client-side-keyed encryption `S3_SSE_C_KEY` / `S3_SSE_C_KEY_PREVIOUS` with key rotation at start (`app:storage:rotate-key`); `app:storage:check` tests the setup. Prepared for later features, nothing uses it yet.
- **Instance name:** new setting `APP_NAME` (default `Club Calendar`) names the installation. It appears as page title and logo text, in e-mails (header, footer, subjects), as default mail sender name in the Docker image, in the passkey prompt (`WEBAUTHN_RP_NAME` still overrides), in authenticator apps and as MCP server name. The Docker image also sets the initial page title at start.

### Changed

- **A worker is required:** e-mails (registration codes, password reset, invitations, notices) are now sent asynchronously by a worker and can arrive slightly later; without a running worker no e-mail is sent. The Docker default `ROLE=all` includes one; outside Docker run `php bin/console messenger:consume async scheduler_default` (dev: `npm run dev:worker`).
- **Existing filesystem caches start cold once** after the upgrade (`CACHE_PREFIX` now seeds the cache keys).

### Removed

- **Host cron:** the crontab entries for `app:prune-*`, `app:holidays:refresh` and `app:geoip:update` are no longer needed and no longer supported; delete them. The commands remain for manual runs.

## [0.1.0] - 2026-11-13

### Added

- **Roles and club membership:** new club role `member` (below `viewer`) for people who belong to a club but may not see its content; they only see the new page "Mein Verein" (calendar and personal subscription) and can leave the club. Invitations and role changes accept `member`. New limits: 500 staff and 5000 members per club.
- **Personal subscription ("Mein Abo"):** every club member has a personal calendar link per club with a selection of feeds and audiences, served as ICS (`GET /api/feed/me/:id/ics?secret=…`) and shown in "Mein Verein"; the profile can renew the link per club. API: `GET|PUT /api/clubs/:id/my-subscription`, `POST …/my-subscription/rotate-secret`, `GET …/my-feeds`, `GET …/my-events`.
- **Joining through feeds:** new club setting "Beitritt über Feeds" (off / internal feeds / also public feeds). A signed-in visitor of a feed page can become a club member and add the feed to their account (`/feed/:feedId/join`); the sign-in and signup flow carries the feed address so registration works under `RESTRICT_REGISTRATION`. Private feeds have a list of assigned members (search, add by member search or pasted e-mail list, remove); renewing a private feed's secret can withdraw the access of members who joined themselves.
- **Multi-factor authentication (MFA):** users can add an authenticator app or passkeys as an additional factor at password sign-in and get backup codes (shown once), managed in the new profile section "Multi-Faktor-Authentifizierung (MFA)". A backup code is used up but MFA stays on; the user is mailed the remaining count. A verified Google or Apple sign-in is not linked automatically to an existing account with MFA on. Operators can reset a locked-out user with `php bin/console app:user:disable-mfa <id|email>`.
- **Step-up confirmation:** sensitive account actions (delete account, change password or e-mail, MFA, passkeys, linking sign-in providers, connecting an app) are confirmed once for 10 minutes with the password (or a mailed code for accounts without a password) plus an MFA factor when MFA is on. Changing the e-mail address now works for accounts without a password.
- **Security notices and log:** notice e-mails with time, IP address, approximate location and browser for password changes, MFA changes, backup code use, passkey changes, linked sign-in providers, newly connected apps and repeated failed sign-ins. A security log of sign-ins and account events is kept for one year (not visible in the app). New cron commands `app:prune-security-events` and `app:prune-auth-nonces`.
- **Location lookup (optional):** MaxMind GeoLite2 City (`MAXMIND_ACCOUNT_ID`, `MAXMIND_LICENSE_KEY`, `GEOIP_DB_PATH`, refreshed by `app:geoip:update`) or, without a key, the visitor's country from a header of a trusted proxy (`CLIENT_COUNTRY_HEADER`, default empty = off). `php bin/console app:geoip:debug <ip> [-H 'Name: value']` shows how a client location is detected.
- **Data download:** users can download their personal data from the profile (tab Privacy, with confirmation, once per hour, notice mail); operators can create it with `php bin/console app:user:export <id|email>`.
- **MCP server and OAuth:** AI clients (Claude, ChatGPT, Gemini) can read the calendar and draft events for a signed-in user at `/api/mcp`, with an OAuth 2.1 consent page, "Verbundene Apps" in the profile, read and write tools and per-user limits. Web servers must route `/.well-known/oauth-*` and `/api/mcp` to PHP (see the admin guide).
- **PDF export** of a calendar (`GET /api/calendars/{id}/events.pdf`): month grid, quarter overview (day list), annual overview and agenda, A4/A3, portrait/landscape, legend for badge icons, optional holidays, "this year" / "next year" ranges. At most 366 days and 2000 events. Requires the PHP extensions `gd` and `intl`.
- **Holidays:** holiday calendars have a type (public, school, other) and can be imported as predefined calendars from OpenHolidays (stored in the database, refreshed after 3 months or with `app:holidays:refresh`; the server must reach `openholidaysapi.org`). Event series can choose which holiday calendars apply to "skip holidays".
- **Sign-in:** email-first sign-in and signup in one flow, passkey autofill on the e-mail field, forms recognised by password managers, brand-compliant Google, Microsoft and Apple buttons, browser Back returns to the e-mail step. `POST /api/auth/identify` is new.
- **Invitations:** open invitations can be re-sent at any time (60 s cooldown); a public preview of an invitation prefills the signup address.
- **Operator options:** `RESTRICT_CLUB_CREATION` (clubs are then created with `php bin/console app:club:create`, the first user may create the first club when `RESTRICT_REGISTRATION=true`); `FEED_ICS_*` window settings and `FEED_RATE_LIMIT_PER_IP` / `FEED_RATE_LIMIT_PER_FEED` for public feeds; `APP_SECRET_PREVIOUS` for secret rotation; `GET /.well-known/change-password` for password managers (custom web servers must route it to PHP).
- **Help and admin guide:** end-user help at `/help` (German and English, with search, screenshots and a subscribe guide at `/help/publishing/subscribe`) and an English admin guide for operators with ready-made Docker Compose and `.env` examples, published at https://silviokennecke.github.io/club-calendar/.
- **Calendar and events:** search in the whole calendar (autocomplete with "Alle Ergebnisse anzeigen"), sortable event list, searchable template picker, location autocomplete with a map in the event form, autosuggest chips for audiences, badges and extras, local autosave of the event form draft, the event form is blocked with a reason while invalid, club page split into General, Calendars and Members tabs (members paginated and searchable), the profile split into tabs with their own addresses (`/profile`, `/profile/security`, `/profile/apps`, `/profile/privacy`).
- Public feed page: subscribe button with platform default and a single-event "Add to calendar" download.

### Changed

- **Breaking:** sensitive account routes need the header `X-Step-Up-Token` (403 `step_up_required` otherwise) and no longer take a password or code in the body: `DELETE /api/auth/me`, `POST /api/auth/change-password` (only `newPassword`), `POST /api/auth/change-email`, `POST /api/auth/mfa/setup|enable|disable|backup-codes`, `POST /api/auth/webauthn/register/options|verify`, `DELETE /api/auth/webauthn/{id}`, `POST /api/auth/oauth/{provider}/link-start|link-complete`, `DELETE /api/auth/oauth/{provider}`. `GET /api/auth/webauthn/register/options` is now `POST`.
- **Breaking:** e-mail confirmation happens in a signed-in restricted session. Registration, login, refresh and SSO of an unconfirmed account return tokens (`emailVerificationRequired`); other routes answer `403 email_verification_required`. `POST /api/auth/verify-email` takes only `{code}`; `loginToken` and `EMAIL_VERIFICATION_LOGIN_TOKEN_TTL` are gone.
- **Breaking:** an empty `MCP_ALLOWED_CLIENTS` now allows no client; use `*` to allow all. The client family `grok` is removed (remove it from your setting, else the app fails at boot); the default is `claude,openai,gemini`. The consent page identifies the app by a label derived from the client family and warns for local or custom callbacks.
- **Breaking:** the SSO start route needs `code_challenge` and `POST /api/auth/token` (`one_time_token`) needs `code_verifier`; the sign-in link only works in the browser tab that started it.
- **Breaking for subscribers:** the feed ICS only contains a default window of events (180 days back, 24 months ahead; configurable with `FEED_ICS_*`), supports ETag/304 and is streamed.
- Sign-in is kept across tabs and browser restarts; signing out applies to all open tabs.
- Calendar exports: ICS location is one part per line (name, street, ZIP city, country) so Apple Calendar shows the map; event titles are `emoji title (extras)` with a badge legend in the description; the single-event download is generated by the backend like the subscription.
- Address search uses the standard Mapbox geocoder and suggests street addresses only; the `name` field of `GET /api/map/geocode/suggest` is removed.
- Terms unified: Audiences (Gruppen), Extras (Zusatzangebote), Badges (Besonderheiten); feed visibility "CLUB" is shown as "Vereinsintern".
- Notices and logs: the password-changed mail names IP address, location and browser; browsers are recognised by a maintained parser (data refreshed at Docker build time); passkey names are not in notices; backup codes are stored with a salted slow hash; the last passkey cannot be deleted while it is the only MFA factor; signing out other devices keeps the original session end.
- Calendar view and UI: PDF and ICS export on one page, one primary action per list, slide and route animations, better touch targets and focus on phones, page titles and focus handling, requests time out when hanging, selects and sorted lists polished, e-mail confirmation code shown as 123-456, the "Import" entry moved out of the sidebar, help pages note that texts were created with the help of AI.
- Performance: ICS output is read without loading entities and streamed in chunks; the event list renders in chunks; new database indexes.

### Fixed

- Apple sign-in sends `response_mode=form_post`, which Apple requires for name and e-mail.
- Concurrent registrations with the same address answer `email_taken` instead of an error.
- ICS import no longer hangs on crafted time zone text.
- Mapbox failures on static map images answer 502 instead of a generic 500.
- Form validation waits for the user to interact with a field; focus returns to the opener after a dialog closes.
- The public feed page finds the club of a signed-in member reliably.

### Security

- E-mail addresses are stored normalized (trimmed, lower-case); pre-hijacking of accounts is closed (only the session that proved the password or SSO login and holds the mailed code can confirm an address).
- Feed and personal subscription secrets are encrypted in the database with a key derived from `APP_SECRET`; existing values are encrypted by `php bin/console app:secrets:rotate` (the Docker entrypoint runs it at start). `APP_SECRET` is now part of what a backup needs; `ext-sodium` is required. Rotation: set `APP_SECRET_PREVIOUS` while running the command.
- SSO (Google, Microsoft, Apple): ID token signature, issuer, audience and expiry are verified, each flow carries a nonce, the login code is bound to the browser tab (PKCE), Microsoft accounts are keyed by tenant and object id; the backend must reach `www.googleapis.com`, `login.microsoftonline.com` and `appleid.apple.com`.
- MCP: an authorization request is bound to the browser that started it by a cookie, approving an app needs the step-up confirmation and mails a notice; requests pending during the update must be restarted.
- Password hashing follows PHP's default and rehashes on login; every API route is signed-in-only unless explicitly public; CORS matches the exact frontend origin; the stored profile club and calendar ids are validated.
- Content-Security-Policy no longer allows `'unsafe-inline'` styles (custom web server configs, e.g. nginx, must take the new header from the admin guide); directory listings and source maps are denied.
- Rate limits for Mapbox tiles, styles, fonts and static images (per user and per IP, answered with 429; behind a reverse proxy set `SYMFONY_TRUSTED_PROXIES`); holiday calendar fetches are limited to 20 per user and hour, follow at most 3 redirects and no longer touch stored holidays on failure; public feeds are rate limited.
- The Mapbox token and MFA secrets and codes no longer reach the logs.
- MFA verification and step-up confirmation are atomic with exact guess budgets; failed attempts are limited and fold in the security log.
- Dependency updates for Symfony (all advisories closed), `symfony/mime` and the MCP bundle.
