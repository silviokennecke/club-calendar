# Protection mechanisms

This page lists what the app does to keep accounts and data safe, and what you, as the admin, need to set up or keep an eye on. Most protections work out of the box.

## Overview

| Mechanism | Protects against | Admin action |
|---|---|---|
| Short-lived sessions | Stolen or forgotten sign-ins | None. Tune lifetimes only if needed. |
| E-mail confirmation by code | Accounts created with someone else's address | Make sure outgoing mail works. |
| Rate limits | Password guessing, spam, flooding | Behind a reverse proxy: set `SYMFONY_TRUSTED_PROXIES`. |
| Registration control | Strangers creating accounts | Set `RESTRICT_REGISTRATION=true` for closed groups. |
| SSO | Weak or reused passwords | Optional. See [SSO](configuration/sso.md). |
| Passkeys | Phishing, password theft | Check the `WEBAUTHN_*` settings. |
| [Password protection](password-protection.md) | The server ever seeing passwords | Always on. Keep the keys safe and backed up. |
| Trusted hosts | Forged `Host` headers, wrong links in mails | List extra host names in `TRUSTED_HOSTS`. |
| Security headers and CSP | Script injection, clickjacking | nginx users must add them. Send HSTS from your TLS proxy. |
| Feed visibility and secret links | Private events becoming public | Choose the right visibility per feed. |
| AI app access (MCP) | Unwanted AI clients | Check `MCP_ALLOWED_CLIENTS`. |
| Quotas | Runaway data growth | None. Fixed limits. |

## Sign-in and sessions

- A sign-in gives the browser a short-lived **access token** (15 minutes) and a **refresh token** (7 days, renewed on every use). Users stay signed in without noticing.
- A session ends at the latest **30 days** after the sign-in, however active the user is.
- Every refresh token works once. If an old one is replayed, the whole session is revoked.
- Users can **sign out everywhere** in their profile. Changing the password, changing the e-mail address, resetting the password and removing a passkey also end all other sessions.

| Variable | Default | Effect |
|---|---|---|
| `REFRESH_TOKEN_ABSOLUTE_LIFETIME` | `2592000` (30 days) | Longest possible session, in seconds. |
| `REFRESH_TOKEN_REUSE_GRACE` | `10` | Seconds in which a refresh token may be sent twice (lost response, two tabs) without ending the session. |
| `OAUTH_LOGIN_CODE_TTL` | `180` | Seconds the one-time code of the SSO redirect stays valid. |

## E-mail confirmation

New accounts must confirm their address with a **6-digit code** sent by mail. The code is valid for 15 minutes, works once and allows 5 attempts. Until it is confirmed, the account can only reach the confirmation step.

- Resending is limited, see [Rate limits]below.
- Unconfirmed accounts are deleted automatically after 30 days by the scheduled command `app:prune-unverified-users` (club members are never deleted this way), see [Operations](operations.md).
- A working mail setup is required, see [Mail and maps](configuration/mail-and-maps.md).

If a user cannot receive the code, you can confirm the address yourself:

```bash
php bin/console app:user:verify user@example.com
```

## Rate limits

Limits slow down attackers and mistakes. When one is hit, the app answers `429` with a `Retry-After` header. They apply to unknown and known addresses alike.

!!! warning "Behind a reverse proxy, set `SYMFONY_TRUSTED_PROXIES`"
    The limits are counted per client IP address. If a proxy or load balancer sits in front of the app and you do not list it in `SYMFONY_TRUSTED_PROXIES` (for example `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`), **all users share the proxy's IP address and its limits**. A few sign-ins would then lock everybody out. This applies to every reverse proxy or TLS terminator in front of the container, including the Caddy of the example `docker-compose.override.yml` (which already sets it). It is only unnecessary when visitors connect to the container directly.

| Action | Limit | Tunable with |
|---|---|---|
| Sign-in | 10 per 15 min per IP, 5 per 15 min per address | `AUTH_LOGIN_IP_LIMIT` (IP only) |
| Registration | 5 per hour per IP, 3 per hour per address | `AUTH_REGISTER_IP_LIMIT` (IP only) |
| Address check on the sign-in page | 30 per 15 min per IP, 10 per 15 min per address | `AUTH_IDENTIFY_IP_LIMIT`, `AUTH_IDENTIFY_EMAIL_LIMIT` |
| Token refresh | 60 per minute per IP | `AUTH_REFRESH_IP_LIMIT` |
| Forgot password | 3 per hour per address, 20 per hour per IP | fixed |
| Confirmation mail resend | 25 per day per IP | fixed |
| Club invitations | 20 per user and 50 per club per day; 5 mails per address per day; re-send once per minute | fixed |
| Public feeds | 120 per minute per IP, 600 per minute per feed | `FEED_RATE_LIMIT_PER_IP`, `FEED_RATE_LIMIT_PER_FEED` (0 = off) |
| PDF export | 10 per user and 30 per IP per 10 min | fixed |
| Maps and address search | several limits | fixed, see [Mail and maps](configuration/mail-and-maps.md) |
| Holiday calendar fetch from a web address | 20 per hour per user | fixed |
| AI app connections | 120 per minute per connection and per IP | fixed |


## Registration control

By default anyone can create an account. To close the app to outsiders:

```ini
RESTRICT_REGISTRATION=true
```

Then only addresses with an **open club invitation** can register, with a password or with SSO. Existing accounts, sign-in and passkeys are not affected.

Create the first user on the command line, because nobody can be invited yet:

```bash
php bin/console app:user:create
```

## Club creation control

By default every signed-in user can create clubs. To keep that to yourself:

```ini
RESTRICT_CLUB_CREATION=true
```

Users then cannot create clubs in the app, and people without a club see a notice that they need an invitation. Invitations, joining and everything else work as before.

The first club: if `RESTRICT_REGISTRATION=true` is set as well, the first user can create the first club in the app while no club exists yet. After that, and in every other setup, you create clubs on the command line:

```bash
php bin/console app:club:create --name "Waldblick Shooting Club" --admin you@example.com
```

`--admin` is an existing user (e-mail address or id) who becomes the club's admin. `--timezone` defaults to `Europe/Berlin`. Missing values are asked interactively. The command ignores the restriction but still respects the per-user limit on the number of clubs.

Invitations are valid for 7 days and can be re-sent by club admins. Nobody is added to a club without accepting an invitation.

## Single sign-on

Google, Microsoft and Apple sign-in are optional. The app verifies the identity token it receives from the provider (issuer, audience, expiry and signature), so a forged token is rejected. A provider that does not prove the user's address (Microsoft) leads to an account that still has to confirm its address by code. Setup is described in [SSO](configuration/sso.md).

## Passkeys

Passkeys let users sign in with fingerprint, face or a device PIN instead of a password.

| Variable | Default | Meaning |
|---|---|---|
| `WEBAUTHN_RP_NAME` | | Name shown in the browser prompt. |
| `WEBAUTHN_RP_ID` | host of `APP_URL` | The domain passkeys are bound to. |
| `WEBAUTHN_USER_VERIFICATION` | `preferred` | `preferred`, `required` or `discouraged`. |

!!! warning "Passkeys are tied to the domain"
    A passkey only works on the domain it was created for. If you change the domain (`WEBAUTHN_RP_ID`, or the host of `APP_URL`), existing passkeys stop working. Users can still sign in with another method and add a new passkey.

Passkeys need HTTPS (except on `localhost`).

## Password protection

The server can be set up so that it never sees users' passwords. This is optional and off by default. See [Password protection](password-protection.md).

## Trusted hosts

The app only answers requests addressed to its own host names: those in `APP_URL`, `FRONTEND_URL` and `BACKEND_URL`, plus `localhost` and loopback addresses (used by health checks). Any other host name gets a `400` error. Links in mails and redirects are always built from the configured URLs, never from what the visitor sent.

If the app is also reachable under another name, for example a `www` alias, list it:

```ini
TRUSTED_HOSTS=www.my-club.example
```

## Security headers

The bundled Caddy configuration (Docker) and `backend/public/.htaccess` (Apache) send the protective browser headers:

- a strict **Content-Security-Policy** (only the app's own scripts, styles and images; no third-party hosts, as maps, fonts and emoji data are served by the app itself),
- `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
- `Referrer-Policy` (`no-referrer` for feed addresses).

!!! warning "What you must do yourself"
    - **nginx or another web server:** add the same headers. Copy them from `.htaccess` or the Caddyfile. The policy string must be identical, including the `wasm-unsafe-eval` entry needed for password protection.
    - **HSTS** (`Strict-Transport-Security: max-age=31536000`): the Docker image runs behind your TLS proxy and does not send it. Set it in the proxy. `.htaccess` sends it for HTTPS requests.
    - **Split setups** (frontend and API on different origins): add the API origin to `connect-src` and `img-src` (the latter for static map images).

## Public feeds

Each feed has one of three visibility levels:

| Level | Who can open it | Search engines |
|---|---|---|
| Public | Anyone with the link | May index it |
| By link only (default) | Anyone with the link | Never indexed |
| Private | Only with the link and a secret | Never indexed |

Private feed addresses contain a secret. Anyone who has the address can read the feed, so share it carefully. A feed can be given a new secret to cut off old addresses. Feed addresses are sent with `Referrer-Policy: no-referrer` so the address does not leak to other sites. The "do not index" header for non-public feeds is set by the app itself, not by the web server.

Feeds are rate limited (see above). The ICS file by default covers the last 180 days and the next 24 months; `FEED_ICS_WINDOW_ENABLED`, `FEED_ICS_PAST_DAYS`, `FEED_ICS_FUTURE_MONTHS` and `FEED_ICS_MAX_EVENTS` change that, see the [reference](configuration/reference.md).

## AI apps (MCP)

The app can let AI assistants (such as Claude, ChatGPT or Gemini) read a user's calendar and create **draft** events, after the user has allowed it on a consent page. AI apps cannot publish or delete events.

- `MCP_ALLOWED_CLIENTS` decides which assistants may connect. Default: `claude,openai,gemini`. `*` allows every app, an empty value allows none.
- Users see and revoke connections under "Connected apps" in their profile. Changing the password or signing out everywhere revokes all of them.
- An empty `MCP_ALLOWED_CLIENTS` now means "no client" (older versions allowed all). After an upgrade, set it to `*` if you want every app to connect.
- In a split setup (web app and API on different addresses), the consent step only works when both addresses are on the same site, for example `app.example.com` and `api.example.com`. AI apps running in a browser on other addresses are blocked.
- Behind a proxy, do not buffer `/api/mcp` and allow long-lived connections.
- With nginx or another web server, the discovery addresses under `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`, and `/api/mcp`, must reach the app, and `/api/mcp` must not be buffered. The bundled Caddy and `.htaccess` already do this.
- Connection lifetimes can be tuned with the `MCP_*` variables, see the [reference](configuration/reference.md).
- Expired entries are cleaned up by the scheduled command `app:prune-oauth` (see [Operations](operations.md)).

## Quotas

Fixed limits keep a single account from filling the database. Exceeding one shows an error to the user.

| Item | Limit |
|---|---|
| Clubs per user | 50 |
| Calendars per club | 100 |
| Members per club | 500 |
| Open invitations per club | 200 |
| Events per calendar | 20,000 |
| Locations per club | 2,000 |
| Audiences per club | 500 |
| Feeds per club | 50 |
| Badges / extras per calendar | 500 each |
| Holiday calendars per calendar | 20 |
| Connected AI apps per user | 20 |
| Events per import | 5,000 |
| Events per series | 366 |
| PDF export | 366 days, 2,000 events |

## Secrets to protect and back up

Keep these out of version control and back them up. Treat them like passwords.

| Secret | Used for | If you change or lose it |
|---|---|---|
| `APP_SECRET` | Signing and hashing of codes, links and one-time tokens; also the default passphrase of the JWT keys | Pending confirmation codes, reset links, passkey challenges and sign-in redirects stop working (sign-ins in progress fail), (the password protection keys are separate and not affected). **Unless `JWT_PASSPHRASE` is set to the old value, the JWT keys can no longer be read and sign-in fails** until you create new keys. Avoid changing it; if you must, set `JWT_PASSPHRASE` to the old value first. |
| `JWT_REFRESH_SECRET` | Refresh tokens | All users are signed out and must sign in again. |
| JWT keys (`/data/config/` in Docker, `backend/config/jwt/` otherwise) | Access tokens (15 minutes) | With new keys, current access tokens become invalid and browsers fetch new ones automatically; users usually notice nothing. Keep the keys between updates anyway. |
| Database password (`DATABASE_URL`) | Database access | The app cannot start until both sides match. |
| `OPAQUE_*` keys | Password protection | **All password records become useless**, and every affected user must reset the password. See [Password protection](password-protection.md). |
| OAuth client secrets | SSO | SSO sign-in fails until updated. |

Never reuse these values between test and production.
