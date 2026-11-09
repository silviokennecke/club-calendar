# Operations (maintainer notes)

Operator documentation (installation, configuration, hosting, security, password protection, legal texts,
operations) lives in the **admin guide**: <https://silviokennecke.github.io/club-calendar/>, sources in
[`../admin/docs/`](../admin/docs/). This file keeps only notes for developers and maintainers.

API reference: [`../api/openapi.yaml`](../api/openapi.yaml). Open items: [`BACKLOG.md`](BACKLOG.md). E2E environment:
[`E2E.md`](E2E.md).

## Migration history

Run with `npm run migrate`; the container entrypoint does it automatically. Notable versions: `Version20261004120000`
(`auth_nonce`), `Version20261004130000` (`user.token_version`), `Version20261009120000` (template times nullable),
`Version20261010120000` (`event.external_uid`), `Version20261013120000` (`password_reset`, `email_change`,
`passkey.last_used_at`, `club_user.last_calendar_id`), `Version20261014120000` (`event_series`, `event.series_id`),
`Version20261015120000` (feed status: `PUBLIC` to `CLUB`, `PRIVATE` stays, `calendar_feed.searchable`; formerly
public feeds are link-only and not indexed afterwards, to be indexed a feed must be set to "Public" with "Findable
by search engines"), `Version20261019120000` (club roles: `club_user.role` viewer|editor|admin, all existing members
become admin, invitations carry a `role`, default editor), `Version20261020120000` (club scoping: `calendar_feed` +
`calendar_feed_calendar` join table, `location` + `target_group` at club level; existing feeds limited to their one
calendar; back up and try on a test environment first), `Version20261025120000` and `Version20261026120000`
(OAuth/MCP tables), `Version20261109140000` (`user.opaque_reminder_days`).

## Drift tests and build notes

- Security headers live identically in `backend/public/.htaccess` and `docker/Caddyfile`
  (`backend/tests/Unit/SecurityHeadersConfigTest.php`). The only allowed inline stylesheet is emoji-mart's fixed one
  in its shadow DOM, by hash `sha256-+A14ONesVdzkn6nr37Osn+rUqNz4oFGZFDbLXrlae04=`; drift test
  `frontend/src/lib/__tests__/cspStyleHash.test.ts`. A changed hash must also be changed in the nginx example in
  `docs/admin/docs/hosting-without-docker.md`.
- Mail templates: after changing `backend/templates/email/*.mjml` run `npm run build:mail -w backend`. The compiled
  `*.html.twig` are gitignored (`npm run build` builds them as well).
- After a deploy the chunks of the previous release are gone; the frontend reloads once on a failed chunk import
  (`vite:preloadError` in `frontend/src/main.tsx`).

## OPAQUE observability (kept here, operator-relevant, to move to the admin guide)

Log lines (Monolog, user id only, never address or token): `opaque.login.success|failure` (reason
`invalid_state`/`authentication_failed`), `opaque.legacy_login.success` (with `upgradeOffered`) / `.failure`
(`wrong_password`/`no_password_hash`), `opaque.upgrade.success`, `opaque.identify.reset_required` (reason
`cutoff`/`flag_off`/`corrupt_record`). Wrong passwords are not visible server-side: the client checks the password
locally against KE2 and aborts before `login/finish`, so `opaque.login.failure` counts only tampered, expired or
reused states. For an error rate compare the number of `login/start` requests with `opaque.login.success`.
Observability of key ids: the server key id and public key are only masked in KE2 (masking key derived from the
password); without the password an account under an old key cannot be told from a fake response. A record with an
unknown key id is treated like a broken one (error log with user id, fake response, `identify` reports
`reset_required`).
