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
| Multi-factor authentication (MFA) | Stolen passwords | None. Users switch it on themselves. Lost devices: `app:user:disable-mfa`. |
| Security log and notices | Unnoticed misuse of an account | Mention the log in your privacy policy. Keep the cleanup job running. |
| Trusted hosts | Forged `Host` headers, wrong links in mails | List extra host names in `TRUSTED_HOSTS`. |
| Security headers and CSP | Script injection, clickjacking | nginx users must add them. Send HSTS from your TLS proxy. |
| Feed visibility and secret links | Private events becoming public | Choose the right visibility per feed. |
| AI app access (MCP) | Unwanted AI clients | Check `MCP_ALLOWED_CLIENTS`. |
| Quotas | Runaway data growth | None. Fixed limits. |

## Sign-in and sessions

- A sign-in gives the browser a short-lived **access token** (15 minutes) and a **refresh token** (7 days, renewed on every use). Users stay signed in without noticing. The refresh token is kept in the browser, so the sign-in survives new tabs and closing the browser; signing out applies to all open tabs. On shared computers users must sign out, because the sign-in stays until then.
- A session ends at the latest **30 days** after the sign-in, however active the user is.
- Every refresh token works once. If an old one is replayed, the whole session is revoked.
- Users can **sign out everywhere** in their profile. Changing the password, changing the e-mail address, resetting the password and removing a passkey also end all other sessions.

| Variable | Default | Effect |
|---|---|---|
| `REFRESH_TOKEN_ABSOLUTE_LIFETIME` | `2592000` (30 days) | Longest possible session, in seconds. |
| `REFRESH_TOKEN_REUSE_GRACE` | `10` | Seconds in which a refresh token may be sent twice (lost response, requests at the same time) without ending the session. |
| `OAUTH_LOGIN_CODE_TTL` | `180` | Seconds the one-time code of the SSO redirect stays valid. |

## Multi-factor authentication (MFA)

Users can turn on multi-factor authentication (MFA) for password sign-in in their profile: besides the password they confirm with a six-digit code from an **authenticator app**, a **passkey**, or both. Once it is on, a password alone is not enough.

- Sign-in with a single sign-on provider or with a passkey does not ask for MFA. A new provider is never linked automatically to an account that has MFA on: the user signs in with password and MFA and links the provider in the profile.
- When it is switched on, the user receives **backup codes**. They are shown once, each works one time, and the user can make new ones at any time.
- Signing in with a **backup code** uses the code up. MFA and the authenticator app stay on. The user is mailed the number of codes left, and the app offers to sign out other devices and to create new codes. With no codes left it warns that the operator must reset MFA if the app or passkey is lost; the profile warns at 2 or fewer codes.
- Only two things end MFA: the user switches it off in the profile (the authenticator app and backup codes are removed, passkeys stay, other sessions and AI app connections end), or an operator runs `app:user:disable-mfa`.
- If a user's account has MFA on, **Sign in with Google or Apple** for an address not yet linked to the account is refused with the advice to sign in with password and MFA and link the provider in the profile. Providers already linked keep working.
- Users receive a notification mail when MFA is switched on or off, when backup codes are made again or used, and when a passkey or a single sign-on provider is added or a passkey is deleted, or an AI app is connected to the account.

Nothing needs configuring. If a user has lost the device with the authenticator app and also has no backup codes, an operator can switch MFA off on the command line, see [Command-line tools](operations.md#command-line-tools). Check the identity of the person first. Run the daily cleanup `app:prune-auth-nonces` as well (see [Operations](operations.md#scheduled-tasks)).

### Confirming sensitive actions

Sensitive account actions need a one-time confirmation on top of the signed-in session: changing the password or e-mail address, deleting the account, switching MFA on or off, setting up the authenticator app, creating new backup codes, adding or removing a passkey, and linking or unlinking a single sign-on provider. The user confirms once with the password (accounts without a password use a code sent by e-mail) and, when MFA is on, also with one MFA factor: an authenticator code, a backup code or a passkey. A stolen session alone is therefore not enough to change sign-in methods.

- The confirmation is valid for 10 minutes and cannot be renewed; after that the user confirms again. It is kept only in the browser tab's session storage, is not shared between tabs and ends on sign-out, password change and other events that end the session.
- A confirmation only works in a session that is still alive. After the user signed out on a device, or after a stolen sign-in was detected and shut down, the leftover short-lived access token of that session can no longer be used to confirm anything, to sign out the other devices or to change the password.
- A confirmation made with the password alone stops counting as soon as MFA is switched on afterwards.
- Accounts without a password get a one-time code by e-mail. Only a code that was actually sent works, it works once, a new code replaces the previous one, and it is valid for 10 minutes.
- Wrong passwords and wrong e-mail codes share one limit of 10 per 15 minutes per account. It is counted exactly, also when many requests arrive at once; once it is used up, even the right password is refused until the oldest attempt is 15 minutes old.
- A backup code used for the confirmation is used up, and the user gets the usual mail.
- Wrong MFA factors, at sign-in and in the confirmation, share one limit of 5 per 15 minutes per account.
- Signing out other devices needs no confirmation.

## Security log

The app keeps a log of security-relevant events for each account. It holds:

- every sign-in (with password, passkey, single sign-on or the connection of an AI app),
- failed sign-in attempts on existing accounts,
- MFA steps and changes, confirmations of sensitive actions, and password changes,
- downloads of personal data (by the user in the profile, or by you with `app:user:export`).

Each entry has the time, the IP address, the approximate city and country, the browser name and version, and the full user agent text the browser sent (at most 512 characters, kept for investigations). Notification mails and the log's browser field show only a well-known browser name (such as Chrome, Firefox, Safari or Edge) with a version number; anything else is shown as unknown, so nobody can smuggle links or other text into notification mails. The full user agent is never shown in mails or in the app. The log is not shown in the app; it is only in the database.

- Failed attempts are merged: repeated failures from the same address within the same clock hour (UTC) count up in one entry. There are at most 50 failure entries per account and day.
- Entries older than **one year** are deleted by the scheduled command `app:prune-security-events` (see [Operations](operations.md#scheduled-tasks)). They are also deleted when the account is deleted.
- **Your privacy policy must say that this log exists**, what it contains and how long it is kept. The [legal documents](legal.md#what-the-security-log-stores) page lists the details.

Users also get a mail when there are **three failed sign-in attempts within one hour** on their account. The app sends at most one such mail per day. Three failed confirmations of a sensitive action within an hour (which can only happen inside a signed-in session) get their own mail with different wording: someone who is signed in failed to confirm, so the user should sign out everywhere and change the password.

## Personal data download

Every user can download their own data in the profile (tab Privacy, "Download data"). The file holds the account, memberships, sign-in methods and history (including IP addresses), consents, connected apps and the club content the user created or last edited. Passwords, secrets and data of other people are not included. The user must confirm their identity first, and gets a notice mail after the download. The limits are in the [rate limit table](#rate-limits). The download is a security log entry and is kept one year like the others.

A user whose e-mail address is not confirmed, or who has not yet accepted the current legal documents, cannot use the download. Such users have to ask you; use `app:user:export` (see [Operations](operations.md#users)). Mention the download in your privacy policy.

The download is built while it is sent, so large accounts take a while. See [PHP settings](hosting-without-docker.md#php-settings-worth-knowing) for the time it needs.

## Location in security notices

Security entries and mails name the approximate location of the sign-in. Two ways to get it:

- **With a MaxMind licence key** (`MAXMIND_ACCOUNT_ID` and `MAXMIND_LICENSE_KEY`): the app uses the GeoLite2 City database, stored on your server. It never asks an external service while users work. You need a free MaxMind account, and using the database means accepting MaxMind's licence terms. The container downloads the database at start when it is missing or older than seven days. Run `app:geoip:update` weekly as well, see [Operations](operations.md#scheduled-tasks). Without the key the command does nothing.
- **Without a key:** only the country is known, and only when your CDN or proxy sends it in a header (`CLIENT_COUNTRY_HEADER`, default empty). Otherwise the location stays empty.

The visitor's address and the country header are trusted only for requests that come through a proxy listed in `SYMFONY_TRUSTED_PROXIES`. Without that list anyone could fake them. The variables are in the [reference](configuration/reference.md#security-notices-and-location).

**Location is empty or wrong?** Simulate a request and see what the app makes of it. The first argument is the address the request comes from (your proxy's address when you use one); add the headers your proxy sends with `-H`:

```bash
php bin/console app:geoip:debug 10.0.0.1 -H 'X-Forwarded-For: 203.0.113.9' -H 'CF-IPCountry: DE'
```

With Docker, run it through `docker compose exec app`. The output shows which method is active, whether the address counts as a trusted proxy, the visitor address the app sees and the city and country found. If nothing is found, it says why. It changes nothing and sends no mail.

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
| Public feeds and personal subscription addresses | 120 per minute per IP, 600 per minute per feed or subscription | `FEED_RATE_LIMIT_PER_IP`, `FEED_RATE_LIMIT_PER_FEED` (0 = off) |
| Joining a club through a feed | 20 per hour per user, 60 per hour per IP | fixed |
| Renewing the personal subscription address | 10 per hour per user | fixed |
| Confirming a sensitive action (password or code, plus the MFA code when MFA is on) | 30 per IP per 15 min; wrong passwords or e-mail codes 10 per user per 15 min (exact); 5 confirmation mails per user per hour; wrong MFA codes share the sign-in limit of 5 per 15 min per user | fixed |
| PDF export | 10 per user and 30 per IP per 10 min | fixed |
| Maps and address search | several limits | fixed, see [Mail and maps](configuration/mail-and-maps.md) |
| Holiday calendar fetch from a web address | 20 per hour per user | fixed |
| Download of personal data (profile) | 1 per hour and 3 per day per user, 10 per day per IP; a failed or aborted download does not count | fixed |
| AI app connections | 120 per minute per connection and per IP | fixed |


## Registration control

By default anyone can create an account. To close the app to outsiders:

```ini
RESTRICT_REGISTRATION=true
```

Then only addresses with an **open club invitation** can register, with a password or with SSO. The exception is a club's feed address: when the club allows joining through feeds (club setting "Joining through feeds", see [Clubs and members](clubs.md#joining-through-feeds); private feeds also need their secret), people who open that feed address can create an account too. Set that club setting to Off to allow invitations only. Existing accounts, sign-in and passkeys are not affected.

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
| `WEBAUTHN_RP_NAME` | `APP_NAME` | Name shown in the browser prompt. |
| `WEBAUTHN_RP_ID` | host of `APP_URL` | The domain passkeys are bound to. |
| `WEBAUTHN_USER_VERIFICATION` | `preferred` | `preferred`, `required` or `discouraged`. |

!!! warning "Passkeys are tied to the domain"
    A passkey only works on the domain it was created for. If you change the domain (`WEBAUTHN_RP_ID`, or the host of `APP_URL`), existing passkeys stop working. Users can still sign in with another method and add a new passkey.

Passkeys need HTTPS (except on `localhost`).

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
    - **nginx or another web server:** add the same headers. Copy them from `.htaccess` or the Caddyfile. The policy string must be identical.
    - **HSTS** (`Strict-Transport-Security: max-age=31536000`): the Docker image runs behind your TLS proxy and does not send it. Set it in the proxy. `.htaccess` sends it for HTTPS requests.
    - **Split setups** (frontend and API on different origins): add the API origin to `connect-src` and `img-src` (the latter for static map images).

## Public feeds

Each feed has one of three visibility levels:

| Level | Who can open it | Search engines |
|---|---|---|
| Public | Anyone with the link | May index it |
| Club-internal (default) | All club members and anyone with the link | Never indexed |
| Private | Only with the link and a secret, or by assignment | Never indexed |

Private feed addresses contain a secret. Anyone who has the address can read the feed, so share it carefully. A feed can be given a new secret to cut off old addresses. Feed addresses are sent with `Referrer-Policy: no-referrer` so the address does not leak to other sites. The "do not index" header for non-public feeds is set by the app itself, not by the web server.

Every club member also has a personal subscription address (a calendar made of the feeds the member picked). It contains a secret, is never indexed and is sent with `Referrer-Policy: no-referrer` like the feed addresses (the existing `/api/feed/` rules cover it, nothing to configure). It only shows what the member may access at that moment, so removing a member or access to a private feed takes effect at once.

A signed-in person who opens a feed address can become a plain club member through it, if a club admin allows it (see [Clubs and members](clubs.md#joining-through-feeds)). When a private feed gets a new secret, admins can also remove the access of everyone who joined with the old one. The old secret stops working in every case. If a private feed is switched to another visibility, the stored access stays but has no effect.

Feeds are rate limited (see above). The ICS file by default covers the last 180 days and the next 24 months; `FEED_ICS_WINDOW_ENABLED`, `FEED_ICS_PAST_DAYS`, `FEED_ICS_FUTURE_MONTHS` and `FEED_ICS_MAX_EVENTS` change that, see the [reference](configuration/reference.md).

## AI apps (MCP)

The app can let AI assistants (such as Claude, ChatGPT or Gemini) read a user's calendar and create **draft** events, after the user has allowed it on a consent page. AI apps cannot publish or delete events.

- `MCP_ALLOWED_CLIENTS` decides which assistants may connect. Default: `claude,openai,gemini`. `*` allows every app, an empty value allows none.
- Allowing a connection needs the same one-time confirmation as other sensitive actions (a stolen sign-in alone cannot connect an app), and the user gets a mail that an app was connected. Denying needs no confirmation.
- Users see and revoke connections under "Connected apps" in their profile. Changing the password or signing out everywhere revokes all of them.
- An empty `MCP_ALLOWED_CLIENTS` now means "no client" (older versions allowed all). After an upgrade, set it to `*` if you want every app to connect.
- In a split setup (web app and API on different addresses), the consent step only works when both addresses are on the same site, for example `app.example.com` and `api.example.com`. AI apps running in a browser on other addresses are blocked.
- Behind a proxy, do not buffer `/api/mcp` and allow long-lived connections.
- With nginx or another web server, the discovery addresses under `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`, and `/api/mcp`, must reach the app, and `/api/mcp` must not be buffered. `/.well-known/change-password` (a redirect for password managers) must reach the app as well. The bundled Caddy and `.htaccess` already do this.
- Connection lifetimes can be tuned with the `MCP_*` variables, see the [reference](configuration/reference.md).
- Expired entries are cleaned up by the scheduled command `app:prune-oauth` (see [Operations](operations.md)).

## Quotas

Fixed limits keep a single account from filling the database. Exceeding one shows an error to the user.

| Item | Limit |
|---|---|
| Clubs per user | 50 |
| Calendars per club | 100 |
| Members per club | 5,000 (of which at most 500 with a staff role: viewer, editor, admin) |
| Open invitations per club | 200 |
| Events per calendar | 20,000 |
| Locations per club | 2,000 |
| Audiences per club | 500 |
| Feeds per club | 50 |
| People with stored access per private feed | 5,000 |
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
| `APP_SECRET` | Encryption of stored feed, personal calendar and authenticator app (MFA) secrets; signing of short-lived tokens; protection of confirmation codes; also the default passphrase of the JWT keys | **Stored feed, calendar and authenticator app secrets cannot be read** until the old value is set as `APP_SECRET_PREVIOUS` and `app:secrets:rotate` has run. Unused confirmation codes, single sign-on redirects and passkey steps in progress stop working. **Unless `JWT_PASSPHRASE` is set to the old value, the JWT keys can no longer be read and sign-in fails.** Follow [Changing `APP_SECRET`](operations.md#changing-app_secret); it also lists what does not depend on it. |
| `JWT_REFRESH_SECRET` | Refresh tokens | All users are signed out and must sign in again. |
| JWT keys (`/data/config/` in Docker, `backend/config/jwt/` otherwise) | Access tokens (15 minutes) | With new keys, current access tokens become invalid and browsers fetch new ones automatically; users usually notice nothing. Keep the keys between updates anyway. |
| Database password (`DATABASE_URL`) | Database access | The app cannot start until both sides match. |
| OAuth client secrets | SSO | SSO sign-in fails until updated. |

Never reuse these values between test and production.
