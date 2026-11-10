# Operations

Day-to-day tasks: updating, backups, scheduled jobs, command-line tools, logs and troubleshooting. The examples assume the Docker setup from the [Quick start](quick-start.md) with the services `app` and `db`. Without Docker, see [Hosting without Docker](hosting-without-docker.md) for the setup.

## Updating

1. Read the release notes (`CHANGELOG.md` in the repository, or the GitHub releases page) for changes that need action.
2. [Back up](#backups) the database and your settings.
3. Update.

=== "Docker"

    The image is `ghcr.io/silviokennecke/club-calendar`. Choose the version with `APP_IMAGE_TAG` in your `.env`:

    | Tag | Meaning |
    |---|---|
    | `1.2.3` | Exactly this release. Recommended for production: you decide when to update. |
    | `latest` | The newest stable release. Pre-releases (`-beta`, `-rc`) are not included. |
    | `main` | Development version. Not for production. |

    To update, change the tag if you pin a version, then:

    ```bash
    docker compose pull
    docker compose up -d
    ```

    At start the container runs database changes (migrations), loads the [legal documents](legal.md) and encrypts stored secrets (see the note below). Check `docker compose ps` until `app` is `healthy`.

    With `RUN_MIGRATIONS=0` in `.env` the container skips the database changes. Then run them yourself after every update, followed by the secrets command:

    ```bash
    docker compose exec app php bin/console doctrine:migrations:migrate --no-interaction
    docker compose exec app php bin/console app:secrets:rotate
    ```

=== "Without Docker"

    Get the new release, then in the repository root:

    ```bash
    composer install --no-dev --optimize-autoloader --working-dir=backend
    npm install && npm run build
    cd backend
    php bin/console doctrine:migrations:migrate --no-interaction
    APP_ENV=prod php bin/console cache:clear
    php bin/console app:legal:sync
    php bin/console app:secrets:rotate
    ```

    Keep your `.env.local` and the `config/jwt/` keys outside the release folder (or copy them over); they are not part of a release. Restart PHP-FPM afterwards.

!!! note "Upgrading to the member role and joining through feeds"
    The update adds the club role **Member** and the club setting **Joining through feeds**. The database changes run with the usual migration step above. Existing members keep their roles. Existing clubs start with **Joining through feeds** set to club-internal feeds only. Check that setting in each club and set it to **Off** if people should only join by invitation, especially with `RESTRICT_REGISTRATION=true`. See [Clubs and members](clubs.md).

!!! note "Upgrading to encrypted secrets"
    Feed secrets (the key of private feeds) and the personal calendar secrets of members are now stored encrypted in the database. Existing values keep working. They are encrypted by the command `app:secrets:rotate`, which the Docker container runs at every start (a failure only logs a warning). Without Docker, run it after the migrations as shown above. The command is safe to repeat and changes nothing that is already encrypted. Calendar subscriptions and feed links do not change.

    From now on **`APP_SECRET` is needed to read these values**: a database backup is useless for them without the matching `APP_SECRET`. Keep both together, see [Backups](#backups).

!!! note "Open browser tabs"
    Visitors who keep the app open during an update reload the page once by themselves when they open a part of the app that no longer exists. No action is needed.

!!! warning "No automatic rollback"
    Database changes of a newer version are not reverted when you go back to an older one. To go back, restore the backup from step 2 together with the older version.

## Backups

Back up regularly and before every update. Keep copies away from the server and test a restore now and then.

| What | Where | If it is lost |
|---|---|---|
| Database | Docker volume `db_data`, dump it as shown below | Everything is gone: clubs, events, users. |
| `.env` (`.env.local` without Docker) | Next to `docker-compose.yml` | You lose all secrets and settings. Losing `APP_SECRET` or `JWT_REFRESH_SECRET` signs everybody out or breaks sign-in, see [Secrets and key rotation](#secrets-and-key-rotation). **Without `APP_SECRET` the encrypted feed and calendar secrets in the database cannot be read**, so every private feed link and personal calendar link would need to be created anew. |
| Login keys (JWT) | Docker volume `jwt`, mounted at `/data/config`; `backend/config/jwt/` without Docker | A new pair is created. Nobody is signed out: browsers fetch new access tokens automatically. Harmless. |
| Legal documents | Your `legal` folder (`/data/legal` in the container) | Re-create the files. See [Legal documents](legal.md). |

The cache (`/data/cache` in the container) is rebuilt automatically and needs no backup.

### Database dump

```bash
docker compose exec -T db sh -c 'mysqldump --single-transaction -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > backup.sql
```

The command reads the database name and root password from the `db` container, so nothing is typed on the command line. Without Docker use `mysqldump --single-transaction -u <user> -p <database> > backup.sql`.

### Login keys

```bash
docker compose cp app:/data/config ./jwt-backup
```

### Restore

1. Stop the app so nobody writes while you restore: `docker compose stop app`.
2. Load the dump:

    ```bash
    docker compose exec -T db sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < backup.sql
    ```

3. Put back `.env` and the login keys (the keys are protected with `APP_SECRET`, see [Secrets and key rotation](#secrets-and-key-rotation)).
4. Start the app: `docker compose up -d`. Use the same version that made the backup, or a newer one: it then updates the database itself.

## Scheduled tasks

The app cleans up after itself only when these commands run regularly. Add them to the cron of the host (or a systemd timer). Run them once a day at night, except where noted.

| Command | What it does | Schedule |
|---|---|---|
| `app:prune-unverified-users` | Deletes accounts that never confirmed their address after 30 days. Club members are kept. | daily |
| `app:prune-password-resets` | Deletes expired password reset links and e-mail change confirmations. | daily |
| `app:prune-refresh-tokens` | Deletes expired sessions. | daily |
| `app:prune-club-invitations` | Deletes invitations that were answered or expired more than 30 days ago. | daily |
| `app:prune-oauth` | Deletes expired entries of AI app connections. | daily |
| `app:holidays:refresh --all` | Refreshes the predefined holiday calendars. See [Holidays](#holidays). | weekly |

=== "Docker"

    Example for the host's crontab (`crontab -e`). Replace `/srv/club-calendar` with the folder that holds your `docker-compose.yml`. `-T` is needed because cron has no terminal.

    ```cron
    0 3 * * * cd /srv/club-calendar && for c in app:prune-unverified-users app:prune-password-resets app:prune-refresh-tokens app:prune-club-invitations app:prune-oauth; do docker compose exec -T app php bin/console $c; done
    0 4 * * 0 cd /srv/club-calendar && docker compose exec -T app php bin/console app:holidays:refresh --all
    ```

=== "Without Docker"

    Run the jobs as the user that runs PHP:

    ```cron
    0 3 * * * cd /var/www/club-calendar/backend && for c in app:prune-unverified-users app:prune-password-resets app:prune-refresh-tokens app:prune-club-invitations app:prune-oauth; do php bin/console $c; done
    0 4 * * 0 cd /var/www/club-calendar/backend && php bin/console app:holidays:refresh --all
    ```

## Command-line tools

The app has a few commands for administrators. Run them like this:

=== "Docker"

    ```bash
    docker compose exec app php bin/console <command>
    ```

=== "Without Docker"

    ```bash
    cd backend
    php bin/console <command>
    ```

`php bin/console list app` shows every command of the app; add `--help` to a command for its options.

### Users

| Command | Purpose |
|---|---|
| `app:user:create` | Creates a user with a confirmed address. Options: `--name`, `--email`, `--password` or `--password-stdin`, `--language=de\|en`. Needed for the first user when registration is closed. Missing values are asked interactively. |
| `app:user:set-password <email or id>` | Sets a new password (`--password` or `--password-stdin`) and ends all sessions of that user. |
| `app:user:verify <email or id>` | Confirms an address by hand, for users who cannot receive the code. Also available as `app:user:activate`. |
| `app:user:reset-link <email>` | Prints a password reset link without sending mail. |

### Clubs

| Command | Purpose |
|---|---|
| `app:club:create` | Creates a club for an existing user, who becomes its admin. Options: `--name`, `--admin=<e-mail or id>`, `--timezone` (default `Europe/Berlin`). Missing values are asked interactively. Works even when `RESTRICT_CLUB_CREATION=true`. |

!!! warning "Reset links give access to the account"
    A link from `app:user:reset-link` (valid 60 minutes) lets whoever opens it set a new password for that account. Hand it only to the owner, over a channel you trust.

!!! tip "Passwords on the command line"
    `--password=...` ends up in the shell history. Prefer `--password-stdin` or the interactive prompt.

### Other tools

| Command | Purpose |
|---|---|
| `app:legal:sync` | Loads changed [legal documents](legal.md) and reports missing ones and invalid links. |
| `app:secrets:rotate` | Encrypts stored feed and calendar secrets with the current `APP_SECRET` and re-encrypts values of older keys. `--dry-run` only counts. Prints counts per column; ends with an error and the ids of rows it cannot read. Safe to repeat. See [Secrets and key rotation](#secrets-and-key-rotation). |
| `app:holidays:refresh` | Refreshes holiday calendars: `--all` for all predefined ones, `--calendar=<id>` for one. |

## Holidays

Predefined holiday and school holiday calendars are loaded from `openholidaysapi.org`, so the server needs outbound HTTPS access to that host. The data is stored in your database and shown from there. The app refreshes a calendar by itself when it is older than three months when someone uses it; the weekly job above keeps all of them current. If the source is down, the stored data stays and is used.

Users can also add their own holiday calendar by the address of an ICS file. The app follows at most three redirects and refuses addresses in private networks (for example `192.168.x.x` or `localhost`). Adding a calendar by address and refreshing it by hand is limited to 20 times per user and hour; the cron job and the automatic refresh are not limited.

## Logs and health

In production the app logs only errors, as JSON lines, together with the few messages that came just before each error. Normal requests and "not found" answers are not logged by the app. Secrets and tokens in addresses are masked in the log.

=== "Docker"

    The log is the container output:

    ```bash
    docker compose logs -f app
    docker compose logs --since 1h app
    ```

    The app does not rotate logs itself; limit their size with Docker's logging options (`max-size`, `max-file`).

=== "Without Docker"

    The log goes to PHP's error output. With PHP-FPM it appears in the FPM error log only if `catch_workers_output = yes` is set in the pool. Web server logs are separate. Use your system's log rotation.

For monitoring, request `https://your-domain/api/health`. It answers `{"status":"ok"}` when the app runs. In the Docker image this check also drives the container's `healthy` status.

## Secrets and key rotation

Rotating a secret has side effects. The full table of what each secret protects and what breaks is in [Protection mechanisms](security.md); in short:

- **Login keys (JWT key pair):** safe to replace. Delete the keys in the `jwt` volume (or `config/jwt/`) and restart; a new pair is created. Nobody is signed out, because access tokens last only 15 minutes and are renewed from the refresh token, which does not use these keys.
- **`JWT_REFRESH_SECRET`:** changing it signs everybody out.
- **`APP_SECRET`:** change it only when you must (for example, it leaked). It is more than a signing key, see below. The steps are in [Changing `APP_SECRET`](#changing-app_secret).

After changing `.env`, restart the app (`docker compose up -d` applies it).

### What `APP_SECRET` is used for

| Used for | If it changes without the steps below |
|---|---|
| Encrypting the secrets of feeds and of members' personal calendar links in the database | These values can no longer be read: private feeds and personal calendar links fail with an error. |
| Passphrase of the login keys (JWT key pair), unless `JWT_PASSPHRASE` is set | The keys cannot be read and sign-in fails for everybody. |
| Signing short-lived tokens: single sign-on redirects and one-time codes, account linking, passkey registration and sign-in in progress | Anything in progress fails; the user starts again. |
| Protecting e-mail confirmation codes | Codes that were sent but not yet used no longer work; the user asks for a new code. |
| Codes for deleting an account and for registering a passkey of an account without a password | An unused code no longer works; the user asks for a new one. |

Password reset links, e-mail change links, refresh tokens (sessions), feed links of public feeds and the connections of AI apps do not depend on `APP_SECRET`. Nobody is signed out by changing it, as long as the login keys can still be read.

### Changing `APP_SECRET`

1. [Back up](#backups) the database and `.env`.
2. In `.env`, set `JWT_PASSPHRASE` to the **old** `APP_SECRET`, so the existing login keys stay readable.
3. Set `APP_SECRET_PREVIOUS` to the old `APP_SECRET`. If you changed it before and some values may still use an older key, list all old values separated by commas.
4. Set `APP_SECRET` to the new value and restart the app. The container re-encrypts all stored secrets at start. To do it by hand (and to see the result), run:

    ```bash
    docker compose exec app php bin/console app:secrets:rotate --dry-run
    docker compose exec app php bin/console app:secrets:rotate
    ```

    The command lists how many values it rewrote per kind. If it reports rows it cannot read, the matching old secret is missing from `APP_SECRET_PREVIOUS`; add it and run the command again. It never prints the secrets themselves.
5. When the command reports no failures, remove `APP_SECRET_PREVIOUS` from `.env` and restart. Keep `JWT_PASSPHRASE`, or create new login keys and remove it (see above).

Until step 5, the old secret stays accepted for reading; after it, only the new one.

## Moving to another domain

1. Change `APP_URL` (and `APP_DOMAIN` if you use the bundled proxy) in `.env`. If the old name should keep working, add it to `TRUSTED_HOSTS`. Restart the app.
2. Update the redirect addresses at your single sign-on providers, see [Single sign-on](configuration/sso.md).
3. Tell your users:
    - **Passkeys stop working.** They are bound to the domain; users sign in with their password or SSO and register a new passkey.
    - **Shared feed links and calendar subscriptions change.** Subscribers must use the new address; redirect the old domain to the new one if you can.
    - **AI apps must reconnect.** Their connection is tied to the old address.

Everybody is signed out once.

## Troubleshooting

| Symptom | Check |
|---|---|
| Container stops right after starting | `docker compose logs app`: a required variable is missing, the database is not reachable. |
| Page shows error 400 for the right address | The host name is not in `APP_URL` or `TRUSTED_HOSTS`. See [Protection mechanisms](security.md). |
| Nobody gets mail, no confirmation codes | `MAILER_DSN` is still the default `null://null`, or the mail server refuses the connection. See [Mail and maps](configuration/mail-and-maps.md). |
| Everybody is blocked with "too many requests" | Behind a proxy `SYMFONY_TRUSTED_PROXIES` is missing, so all users share one address. See [Protection mechanisms](security.md). |
| Everybody has to sign in again after every restart | `JWT_REFRESH_SECRET` changes between starts (for example it is generated at each start). |
| Sign-in fails for everybody after changing `APP_SECRET` | The login keys were protected with the old value. Set `JWT_PASSPHRASE` to the old `APP_SECRET`. |
| Private feed or personal calendar link answers with an error after changing `APP_SECRET` | The stored secrets were encrypted with the old value. Put it in `APP_SECRET_PREVIOUS` and run `app:secrets:rotate`. |
| Single sign-on fails | The app is served over plain HTTP, or the redirect address at the provider does not match. See [Single sign-on](configuration/sso.md). |
| Maps are empty | `MAPBOX_TOKEN` is missing or invalid. See [Mail and maps](configuration/mail-and-maps.md). |
| Legal documents missing | Run `app:legal:sync` and read its warnings. See [Legal documents](legal.md). |
| Holiday calendars do not load | The server cannot reach `openholidaysapi.org` over HTTPS. |
| Cleanup jobs seem to do nothing | Check that the cron entries exist and use `-T` with Docker. |
