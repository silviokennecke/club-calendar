# Changelog

All notable changes to this project are documented in this file, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and are released as git tags `vX.Y.Z`.

## [Unreleased]

### Added

- PDF export of a calendar (`GET /api/calendars/{id}/events.pdf`): month grid, quarter overview, annual overview and agenda, A4/A3, portrait/landscape, with a legend for property icons; output language and first weekday follow the profile. At most 366 days and 2000 events per PDF. Requires the PHP extensions `gd` and `intl`.
- User documentation for all features in `/help`, including the subscribe guide with app tabs (iPhone/iPad, Mac, Outlook, Google Calendar) at `/help/publishing/subscribe`; the old `/help/subscribe` URL (with `?app=`) redirects there.
- In-app help at `/help` (German and English) with full-text search and contextual `HelpLink`s, compiled from Markdown at build time; screenshots are generated with Playwright (`npm run docs:screenshots`).

### Changed

- E-mail confirmation now needs a signed-in, restricted session: registration, password login, refresh and SSO of an unconfirmed account return tokens (`emailVerificationRequired`), but every route except the own profile, consent, sign-out and the confirmation itself answers `403 email_verification_required`. `POST /api/auth/verify-email` takes only `{code}` with that session and returns a fresh token pair; `POST /api/auth/resend-verification` needs the session and no body. Login of an unconfirmed account no longer answers `403 email_not_verified`, the SSO callback no longer redirects with `error=email_verification_required`, and the `loginToken` / `EMAIL_VERIFICATION_LOGIN_TOKEN_TTL` are gone.
- Page footers show a single help link: the help center (`/help`), on public calendar pages the subscribe guide; the help pages show only the legal links.

### Security

- Pre-hijacking of accounts is closed: someone who registers a stranger's address with an own password can no longer be confirmed by the mailbox owner's code. Only the session that proved the password (or SSO login) and holds the mailed code can confirm the address.
