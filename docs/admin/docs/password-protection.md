# Password protection

By default, the app receives a user's password when they sign in and stores a one-way hash of it. With **password protection** switched on, the password never reaches the server at all: the browser proves that the user knows it without sending it. This is based on the OPAQUE protocol (RFC 9807).

Users notice nothing, except that sign-in takes a moment longer. The feature is **off by default**.

!!! info "Why bother"
    Even a compromised server, log file or proxy cannot reveal passwords, because they are never sent.

## What changes

- New accounts and password resets use the new method as soon as `OPAQUE_ENABLED=true`, whatever the percentage is.
- Existing accounts are switched in the background the next time they sign in. This is controlled by a percentage (`OPAQUE_ROLLOUT_PERCENT`).
- While the feature is on, the old password sign-in refuses accounts that already use the new method.
- Users who sign in only with SSO or passkeys are not affected.

## Prerequisites

- PHP extension `ext-sodium` (included in the Docker image).
- Two secret keys, generated once and stored permanently (below).
- On nginx or another server: the Content-Security-Policy must contain `'wasm-unsafe-eval'`, see [Protection mechanisms](security.md). The bundled Caddy and `.htaccess` already do.

## Rollout

!!! tip "Take a database backup before you start."
    Recommended order: deploy with the feature off, switch it on in a test installation first, then in production at 10, 50 and 100 %.

1. **Generate the keys.**

    ```bash
    php bin/console app:opaque:generate-keys
    ```

    In Docker: `docker compose exec app php bin/console app:opaque:generate-keys`. The command only prints the values. It stores nothing.

2. **Store and back them up.** Put both values into your secret store and make a backup. If you lose them, every password record is useless and every affected user must reset their password.

    ```ini
    OPAQUE_OPRF_SEED=...
    OPAQUE_SERVER_PRIVATE_KEY=...
    ```

3. **Switch it on, still at 0 %.**

    ```ini
    OPAQUE_ENABLED=true
    OPAQUE_ROLLOUT_PERCENT=0
    ```

    Check the setup:

    ```bash
    php bin/console app:opaque:check
    ```

    The Docker image runs this check at every start, before the database update, and refuses to start with missing or invalid keys. Without the Docker entrypoint, run it in your deploy.

4. **Increase the percentage in steps**, for example 10, then 50, then 100. Increasing never takes accounts out again. After each step look at the numbers:

    ```bash
    php bin/console app:opaque:status
    php bin/console app:opaque:status --json
    ```

    The output shows how many accounts use the new method, the old one or no password, and the "migrated" share. It contains no personal data. Accounts are switched when their owner signs in, so the share grows over time.

5. **Set a cutoff date (optional, phase 2).** Once the percentage is 100, give the remaining users some time (about 30 days) and then set the date:

    ```ini
    OPAQUE_ROLLOUT_PERCENT=100
    OPAQUE_LEGACY_CUTOFF=2027-03-01
    ```

    The date is `YYYY-MM-DD` in UTC. A cutoff requires `OPAQUE_ROLLOUT_PERCENT=100`. From that date, accounts without the new method must use "Forgot password" to continue.

6. **Run the reminder job daily** (see [Scheduled tasks](operations.md)):

    ```bash
    php bin/console app:opaque:notify-legacy
    ```

    It mails accounts that were not switched yet, 14 days and 3 days before the cutoff (UTC dates). Each reminder is sent once; a missed stage is skipped and failed sends are not retried. Options: `--dry-run` (show only) and `--limit=500` (mails per run, the rest follows next run). It does nothing without the feature, without a cutoff, earlier than 14 days before it, or after it.

7. **After the cutoff, retire the old hashes once.**

    ```bash
    php bin/console app:opaque:retire-legacy          # dry run: only counts
    php bin/console app:opaque:retire-legacy --force  # deletes the remaining old hashes
    ```

    It refuses to run before the cutoff, with the feature off, or below 100 %. Make a backup first. Running sessions stay valid. Afterwards going back to the old method is no longer possible without every user resetting the password.

## Rotating keys

Rotation lets you introduce a new key set without a hard break. Several key sets are listed by id, and new passwords use the active one.

1. Generate a new set with `app:opaque:generate-keys`.
2. Add it as `OPAQUE_KEYS` in the form `id:seed:privateKey` (id of 1 to 16 characters). Several sets are separated by commas. The old pair `OPAQUE_OPRF_SEED` / `OPAQUE_SERVER_PRIVATE_KEY` always counts as id `1`:

    ```ini
    OPAQUE_KEYS=2:<seed>:<privateKey>
    ```

3. Run `php bin/console app:opaque:check`.
4. Make the new set the active one and deploy:

    ```ini
    OPAQUE_ACTIVE_KEY_ID=2
    ```

5. Accounts move to the new key only when the user next changes or resets their password. A re-key at sign-in is not possible. An account whose record uses a key id that is no longer configured must use "Forgot password".
6. `app:opaque:status` shows how many records use each key. Remove an old key only when none do. `app:opaque:check` warns about unused keys and about records whose key is no longer configured.

!!! warning
    Do not change `OPAQUE_ACTIVE_KEY_ID` while people are in the middle of registering: they would have to reset their password afterwards.

    If a key was **compromised**, do not just replace it. Remove its id from the configuration, so that all accounts under it must reset their password.

## Turning it off again

!!! danger "Do not switch the feature off once accounts exist that only have the new method"
    With `OPAQUE_ENABLED=false`, accounts that have a new-style record cannot sign in any more. They must use "Forgot password" (or you run `app:user:set-password`), which sets a classic password again. Accounts that were switched but still have their old hash (before phase 2) keep working with the old method.

Before any rollback, run `app:opaque:status` (accounts with a record but without an old hash cannot sign in) and take a backup. After `app:opaque:retire-legacy --force` a rollback affects every account.

## Watching it run

The app logs `opaque.*` lines (user id only, never address or password): `opaque.login.success`, `opaque.login.failure`, `opaque.legacy_login.success` and `.failure`, `opaque.upgrade.success` and `opaque.identify.reset_required`. In production only errors are logged (with the few lines before them, see [Operations](operations.md)), so these lines show up mostly around problems.

- Wrong passwords are not visible on the server: the browser notices them itself. `opaque.login.failure` counts only damaged, expired or replayed sign-in attempts.
- For progress and counts use `app:opaque:status`, not the log.
- **Alert on error log entries about a record with an unknown key id.** They mean a key was removed while accounts still use it; those users must use "Forgot password".

## Command reference

| Command | Purpose |
|---|---|
| `app:opaque:generate-keys` | Print new keys. Stores nothing. |
| `app:opaque:check` | Validate keys, rollout and cutoff. Exits with an error if the feature is on and the setup is invalid. Warns about unused keys. |
| `app:opaque:status [--json]` | Count accounts per method and show the migrated share. |
| `app:opaque:notify-legacy [--dry-run] [--limit=N]` | Cutoff reminder mails (daily cron). |
| `app:opaque:retire-legacy [--force]` | Delete remaining old hashes after the cutoff. |

## Creating users from the command line

With the feature on, the user commands do not take a password. They create the account without one and print a **one-time link** (valid 60 minutes) where the user sets a password in the browser:

```bash
php bin/console app:user:create --name="Anna" --email=anna@example.com
php bin/console app:user:set-password anna@example.com --link
```

`app:user:set-password` also ends all sessions of that user. Treat the link like a password and give it only to its owner. Passing `--password` still works but creates an old-style account and prints a warning. After the cutoff it needs `--force-legacy`.

## Settings at a glance

| Variable | Default | Meaning |
|---|---|---|
| `OPAQUE_ENABLED` | `false` | Switch the feature on. |
| `OPAQUE_OPRF_SEED`, `OPAQUE_SERVER_PRIVATE_KEY` | | Key set `1`. Required when enabled. |
| `OPAQUE_KEYS`, `OPAQUE_ACTIVE_KEY_ID` | | More key sets and the active id (default `1`). |
| `OPAQUE_ROLLOUT_PERCENT` | `0` | Share of old accounts offered the switch. |
| `OPAQUE_LEGACY_CUTOFF` | empty | Date after which unswitched accounts must reset. Needs 100 %. |

More settings are listed in the [configuration reference](configuration/reference.md); daily jobs are in [Operations](operations.md).
