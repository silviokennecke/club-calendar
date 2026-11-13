# Operations

Day-to-day tasks: updating, backups, the worker and scheduled jobs, command-line tools, logs and troubleshooting. The examples assume the Docker setup from the [Quick start](quick-start.md) with the services `app` and `db`. Without Docker, see [Hosting without Docker](hosting-without-docker.md) for the setup.

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

    Keep your `.env.local` and the `config/jwt/` keys outside the release folder (or copy them over); they are not part of a release. Restart PHP-FPM and the worker and scheduler services afterwards (`systemctl restart club-calendar-worker club-calendar-scheduler`, see [Hosting without Docker](hosting-without-docker.md#background-jobs-and-the-worker)); they keep the old code in memory until restarted.

!!! note "Upgrading to the member role and joining through feeds"
    The update adds the club role **Member** and the club setting **Joining through feeds**. The database changes run with the usual migration step above. Existing members keep their roles. Existing clubs start with **Joining through feeds** set to club-internal feeds only. Check that setting in each club and set it to **Off** if people should only join by invitation, especially with `RESTRICT_REGISTRATION=true`. See [Clubs and members](clubs.md).

!!! note "Upgrading to encrypted secrets"
    Feed secrets (the key of private feeds) and the personal calendar secrets of members are now stored encrypted in the database. Existing values keep working. They are encrypted by the command `app:secrets:rotate`, which the Docker container runs at every start (a failure only logs a warning). Without Docker, run it after the migrations as shown above. The command is safe to repeat and changes nothing that is already encrypted. Calendar subscriptions and feed links do not change.

    From now on **`APP_SECRET` is needed to read these values**: a database backup is useless for them without the matching `APP_SECRET`. Keep both together, see [Backups](#backups).

!!! note "Upgrading to the built-in scheduler and mail queue"
    Cron entries for the `app:prune-*`, `app:holidays:refresh` and `app:geoip:update` commands are no longer used and must be removed. All e-mail is now sent by a background worker, which the Docker image starts by default. See [Scheduled tasks and the worker](#scheduled-tasks-and-the-worker).

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

The cache (`/data/cache` in the container) is rebuilt automatically and needs no backup. If you use S3 storage with a customer key, back up that key (see [Cache and storage](cache-and-storage.md#storage)).

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

## Scheduled tasks and the worker

The app runs its own background jobs. No cron entries or timers on the host are needed, and an external cron is not supported. Two things work together:

- The **scheduler** starts the periodic jobs below at fixed times. It only puts them in a queue.
- The **worker** takes jobs from the queue and runs them. It also sends all e-mail.

!!! warning "Without a worker no mail is sent"
    Every e-mail (confirmation codes, password resets, invitations, notices) goes through the queue. If no worker runs, nobody can confirm an address, so for example registration cannot be completed. The standard Docker setup starts a worker and the scheduler for you. Without Docker you start both yourself, see [Hosting without Docker](hosting-without-docker.md#background-jobs-and-the-worker).

Mails can arrive a few seconds later than the action that caused them. A mail that cannot be sent is tried again three times, after about 1, 2 and 4 seconds; after that it moves to the list of failed messages (see [The queue](#the-queue)).

### Schedule

The times are fixed and in UTC (there is no setting per job). A job that was missed because the app was down runs once when it is back.

| Job | What it does | When (UTC) |
|---|---|---|
| Unconfirmed accounts | Deletes accounts that never confirmed their address after 30 days. Club members are kept. | daily 02:00 |
| Password reset links | Deletes expired password reset links and e-mail change confirmations. | daily 02:10 |
| Sessions | Deletes expired sessions. | daily 02:20 |
| Club invitations | Deletes invitations that were answered or expired more than 30 days ago. | daily 02:30 |
| AI app connections | Deletes expired entries of AI app connections. | daily 02:40 |
| Security log | Deletes security log entries older than one year. See [Protection mechanisms](security.md#security-log). | daily 02:50 |
| One-time values | Deletes expired one-time sign-in values. | daily 03:00 |
| Failed messages | Deletes failed queue entries older than 30 days. | daily 03:10 |
| Holidays | Refreshes the predefined holiday calendars. See [Holidays](#holidays). | Sundays 03:30 |
| Location database | Downloads a newer location database for security notices. Does nothing without `MAXMIND_LICENSE_KEY`. See [Protection mechanisms](security.md#location-in-security-notices). | Sundays 03:50 |

If a cleanup job fails, it is retried and then lands in the failed messages. The holiday refresh and the location update only log a warning when they fail and try again the next week.

To see the list as the app knows it, run `php bin/console debug:scheduler`.

### Roles in the Docker image

One image can play different roles, chosen with `ROLE`:

| `ROLE` | Runs |
|---|---|
| `all` (default) | The web server and the PHP application, plus workers and the scheduler. Right for a single server. |
| `web` | Only the web server and the PHP application. Also runs the database changes at start. |
| `worker` | Only workers and the scheduler. No web server, no port. Waits at start until the database changes are done. |

Further settings:

- `MESSENGER_WORKERS` (default `2`, from 1 to 32): how many workers run in one container. They restart by themselves after an hour or when they use too much memory.
- `SCHEDULER_ENABLED` (default `true`): `false` leaves out the scheduler in this container. Only one scheduler in your whole installation fires a job at a time (a lock in the database sees to that), so extra schedulers are harmless.
- `MIGRATION_WAIT_RETRIES` (default `90`): how often a worker container checks (2 seconds apart) whether the database changes are done before it gives up.

If the web server or a program in the container fails for good, the container stops with an error so that Docker or your orchestrator can restart it. The container is `healthy` only while all its programs run (and, with a web server, `/api/health` answers). Logs of all programs go to the container output.

### Running a job by hand

The jobs stay available as commands, for testing or when you do not want to wait. They do the same as the scheduler:

| Command | Job |
|---|---|
| `app:prune-unverified-users` | Unconfirmed accounts |
| `app:prune-password-resets` | Password reset links |
| `app:prune-refresh-tokens` | Sessions |
| `app:prune-club-invitations` | Club invitations |
| `app:prune-oauth` | AI app connections |
| `app:prune-security-events` | Security log |
| `app:prune-auth-nonces` | One-time values |
| `app:prune-failed-messages` | Failed messages |
| `app:holidays:refresh --all` | Holidays |
| `app:geoip:update` | Location database |

### The queue

The queue lives in the database (table `messenger_messages`), so it needs nothing extra. Everything in it is stored encrypted. Run the commands as described under [Command-line tools](#command-line-tools).

| Command | Purpose |
|---|---|
| `messenger:stats` | Shows how many messages wait. A number that keeps growing means no worker runs or the workers are too slow. |
| `messenger:failed:show --transport=failed` | Lists messages that failed after all retries. |
| `messenger:failed:retry --transport=failed` | Tries them again (add an id to retry one). |
| `messenger:failed:remove --transport=failed <id>` | Removes one entry for good. |

Failed messages are deleted automatically after 30 days. Log lines about a failed mail can contain the recipient's address, so treat logs as sensitive.

!!! warning "Queued mails and `APP_SECRET`"
    Because queued messages are encrypted with a key derived from `APP_SECRET`, they can only be read with it. `app:secrets:rotate` does **not** re-encrypt messages that are already queued. Before you drop the old `APP_SECRET`, wait until the queue is empty (`messenger:stats`) and the failed list is cleared, or keep the old value in `APP_SECRET_PREVIOUS` until then. Messages that cannot be read count as failed.

### Upgrading from cron

1. Remove the old cron entries (or timers) for `app:prune-*`, `app:holidays:refresh` and `app:geoip:update`.
2. Make sure a worker and the scheduler run. With the standard Docker setup (`ROLE=all`) they do; without Docker see [Hosting without Docker](hosting-without-docker.md#background-jobs-and-the-worker).
3. The database changes for the queue, the lock and the scheduler run with the usual migration step.
4. Optionally set up [cache and storage](cache-and-storage.md).

### Several containers

For more than one server or container, run the same image several times:

- One or more `web` containers (port 8080, behind your proxy) and one or more `worker` containers, all on the same database. A worker container needs no port, no legal documents and no login keys.
- A worker container needs the same settings as the web containers: `APP_SECRET` (and `APP_SECRET_PREVIOUS` while rotating), `JWT_REFRESH_SECRET`, `DATABASE_URL`, `APP_URL`, `MAILER_DSN` and `MAILER_FROM`. Use a shared `CACHE_DSN` (see [Cache and storage](cache-and-storage.md)) when rate limits and cache should be shared.
- Give containers time to finish running jobs when they stop: set `stop_grace_period: 90s` (Compose) or the equivalent in your orchestrator.
- The database changes, the secrets encryption and the storage key rotation run only in `web` and `all` containers.

!!! note "Location database with several containers"
    The weekly location database update stores the file in the [file storage](cache-and-storage.md), and every container fetches its own copy from there when it needs it. With several containers the storage must therefore be shared by all of them (an S3 bucket or a shared volume); with a shared Redis cache all containers notice a new file at once, otherwise within an hour. Without `MAXMIND_LICENSE_KEY` this does not apply.

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
| `app:user:export <email or id>` | Writes all personal data of a user as a JSON file, for data access requests or users who cannot download it themselves. Prints to the screen by default; `--output=<file>` writes a file that only the current user can read. An existing file is not overwritten unless you add `--force`. Writes a security log entry; the user is not notified and no rate limit applies. See the warning below. |
| `app:user:disable-mfa <email or id>` | Switches MFA off for a user who lost the authenticator app and all backup codes (or the passkey). This is the only way to help such a user besides their own switch in the profile. Removes the authenticator app and backup codes (passkeys stay), ends all sessions and AI app connections, mails the user and writes a security log entry. No password needed; nothing happens if MFA is off. |

### Clubs

| Command | Purpose |
|---|---|
| `app:club:create` | Creates a club for an existing user, who becomes its admin. Options: `--name`, `--admin=<e-mail or id>`, `--timezone` (default `Europe/Berlin`). Missing values are asked interactively. Works even when `RESTRICT_CLUB_CREATION=true`. |

!!! warning "Switching off MFA"
    `app:user:disable-mfa` switches MFA off without the user's password. Use it only after you have confirmed the person's identity, and only when the user has neither the authenticator app nor the backup codes. Normally the user uses a backup code (MFA stays on) or switches it off in the profile.

!!! warning "Handle exports with care"
    The file from `app:user:export` contains personal data: account data, sign-in history with IP addresses, consents and more. Passwords, secrets and data of other people are not included. Hand it only to the person it is about, over a channel you trust, store it only as long as needed and delete it afterwards (also from backups and download folders).

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
| `app:storage:check` | Writes, reads and deletes a test file in the configured file storage and prints which storage is used. See [Cache and storage](cache-and-storage.md#storage). |
| `app:storage:rotate-key` | Re-encrypts S3 files with a new customer key. `--dry-run` only counts. See [Cache and storage](cache-and-storage.md#rotating-the-key). |
| `cache:pool:clear` | Empties shared caches in Redis or Valkey. See [Cache and storage](cache-and-storage.md#clearing-the-cache). |

## Browser recognition

Sign-in notification mails and the security log name the browser used (for example "Chrome 126"). The app recognises browsers from a maintained list of patterns. Nothing is downloaded while the app runs, and the server needs no extra internet access for this.

=== "Docker"

    The list is refreshed every time the image is built, so each new release contains current data. Updating to a newer image (see [Updating](#updating)) is all you need. If you rebuild the image yourself, Docker reuses its cached layers when nothing changed, so an unchanged rebuild keeps the old list. To force a fresh list, build with `docker build --no-cache-filter runtime ...`; to keep the current list, change nothing. If the build cannot reach the source, it keeps the list that ships with the software and prints a warning in the build log.

=== "Without Docker"

    The list ships with the software. To refresh it between releases, run this in the `backend/` folder:

    ```bash
    composer update ua-parser/uap-php --no-dev
    ```

    A browser that is not recognised is shown as "unknown" in the mails; nothing else is affected.

## Holidays

Predefined holiday and school holiday calendars are loaded from `openholidaysapi.org`, so the server needs outbound HTTPS access to that host. The data is stored in your database and shown from there. The app refreshes a calendar by itself when it is older than three months when someone uses it; the weekly job (see [Scheduled tasks](#scheduled-tasks-and-the-worker)) keeps all of them current. If the source is down, the stored data stays and is used.

Users can also add their own holiday calendar by the address of an ICS file. The app follows at most three redirects and refuses addresses in private networks (for example `192.168.x.x` or `localhost`). Adding a calendar by address and refreshing it by hand is limited to 20 times per user and hour; the scheduled job and the automatic refresh are not limited.

## Logs and health

In production the app logs only errors, as JSON lines, together with the few messages that came just before each error. Normal requests and "not found" answers are not logged by the app. Secrets and tokens in addresses are masked in the log, but this is a best-effort safeguard: treat the logs as sensitive, restrict who can read them and do not share them unredacted. Failed e-mail deliveries are logged by the worker, and the log entry can contain the recipient address.

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
| Encrypting the secrets of feeds, of members' personal calendar links and of authenticator apps (MFA) in the database | These values can no longer be read: private feeds and personal calendar links fail with an error, and users with an authenticator app cannot use it to sign in (backup codes and passkeys still work). |
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

    The command also re-encrypts the authenticator app secrets of MFA. The command lists how many values it rewrote per kind. If it reports rows it cannot read, the matching old secret is missing from `APP_SECRET_PREVIOUS`; add it and run the command again. It never prints the secrets themselves.
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
| A user cannot sign in with the authenticator app | After an `APP_SECRET` change the stored secret cannot be read (see the row above). Otherwise the device is lost. Backup codes still work. If they are gone too, run `app:user:disable-mfa` after checking the person's identity. |
| Security mails show no city or country | No MaxMind key is set, or the database is missing or old: see [Location in security notices](security.md#location-in-security-notices). |
| Single sign-on fails | The app is served over plain HTTP, or the redirect address at the provider does not match. See [Single sign-on](configuration/sso.md). |
| Maps are empty | `MAPBOX_TOKEN` is missing or invalid. See [Mail and maps](configuration/mail-and-maps.md). |
| Legal documents missing | Run `app:legal:sync` and read its warnings. See [Legal documents](legal.md). |
| Holiday calendars do not load | The server cannot reach `openholidaysapi.org` over HTTPS. |
| Cleanup jobs seem to do nothing, or no mail arrives although `MAILER_DSN` is set | No worker runs, or the queue is stuck. Check `docker compose ps` and the logs, and run `messenger:stats` and `messenger:failed:show --transport=failed`. See [Scheduled tasks and the worker](#scheduled-tasks-and-the-worker). |
