# Password protection

Club Calendar never receives a user's password. When someone signs in, the browser proves that the user knows the password without sending it. This is based on the OPAQUE protocol (RFC 9807). The feature is **always on** and cannot be switched off.

Users notice nothing, except that sign-in takes a moment longer.

!!! info "Why bother"
    Even a compromised server, log file or proxy cannot reveal passwords, because they are never sent.

!!! danger "Breaking change: the server keys are mandatory"
    Older versions had a switch (`OPAQUE_ENABLED`) and a percentage (`OPAQUE_ROLLOUT_PERCENT`). Both are gone and ignored. The app does not start without the keys below. See [Upgrading from older versions](#upgrading-from-older-versions).

## What it means for you

- Every installation needs a pair of secret keys, generated **once** and kept permanently.
- New accounts and password resets always use the new method.
- Accounts created by older versions (with the old kind of password storage) are converted in the background the next time their owner signs in. There is no percentage to manage any more. The only setting is an optional end date for this conversion (`OPAQUE_LEGACY_CUTOFF`).
- Users who sign in only with SSO or passkeys are not affected.

## Prerequisites

- PHP extension `ext-sodium` (included in the Docker image).
- The keys (below).
- On nginx or another server: the Content-Security-Policy must contain `'wasm-unsafe-eval'`, see [Protection mechanisms](security.md). The bundled Caddy and `.htaccess` already do.

## Setting up the keys

1. **Generate the keys.**

    ```bash
    php bin/console app:opaque:generate-keys
    ```

    With Docker, before the first start (the app is not running yet):

    ```bash
    docker run --rm --env-file .env ghcr.io/silviokennecke/club-calendar:latest php bin/console app:opaque:generate-keys
    ```

    When the app already runs: `docker compose exec app php bin/console app:opaque:generate-keys`. The command only prints the values. It stores nothing.

2. **Store and back them up.** Put both values into your `.env` or secret store and make a backup. If you lose them, every password record is useless and every user must reset their password.

    ```ini
    OPAQUE_OPRF_SEED=...
    OPAQUE_SERVER_PRIVATE_KEY=...
    ```

3. **Check the setup:**

    ```bash
    php bin/console app:opaque:check
    ```

    The Docker image runs this check at every start, before the database update, and **refuses to start** with missing or invalid keys. The keys are never created automatically: silently generating new ones, for example after a lost `.env`, would lock out every user. Without the Docker entrypoint, run the check in your deploy.

## Converting existing accounts

Accounts from older versions are converted at their owner's next sign-in. There is nothing to do, but you can watch the progress:

```bash
php bin/console app:opaque:status
php bin/console app:opaque:status --json
```

The output shows how many accounts use the new method, the old one or no password, and the "migrated" share. It contains no personal data.

Accounts whose owners rarely sign in stay on the old method for a long time. If you want to end that, set a cutoff date.

### Cutoff date (optional)

```ini
OPAQUE_LEGACY_CUTOFF=2027-03-01
```

The date is `YYYY-MM-DD` in UTC. Empty, or a date in the future, means: conversion is active and every confirmed account is converted at its next sign-in. **On and after the date**, accounts that were not converted must use "Forgot password" to continue. Give your users some time (about 30 days) before the date.

1. **Run the reminder job daily** (see [Scheduled tasks](operations.md)):

    ```bash
    php bin/console app:opaque:notify-legacy
    ```

    It mails accounts that were not converted yet, 14 days and 3 days before the cutoff (UTC dates). Each reminder is sent once; a missed stage is skipped and failed sends are not retried. Options: `--dry-run` (show only) and `--limit=500` (mails per run, the rest follows next run). It does nothing without a cutoff, earlier than 14 days before it, or after it.

2. **After the cutoff, retire the old hashes once.**

    ```bash
    php bin/console app:opaque:retire-legacy          # dry run: only counts
    php bin/console app:opaque:retire-legacy --force  # deletes the remaining old hashes
    ```

    It refuses to run before the cutoff. Make a backup first. Running sessions stay valid. Afterwards the old method is gone for good; users who did not convert need "Forgot password".

## Upgrading from older versions

!!! warning "Generate the keys before you update, otherwise the container will not start"
    1. Generate the keys with `app:opaque:generate-keys` (see above) **before** you pull the new version.
    2. Add `OPAQUE_OPRF_SEED` and `OPAQUE_SERVER_PRIVATE_KEY` to your `.env`, and back them up.
    3. If you used the feature before, reuse the **same** keys. New keys would make every existing password record useless.
    4. Remove `OPAQUE_ENABLED` and `OPAQUE_ROLLOUT_PERCENT` from your settings (they are ignored).
    5. Update. Check `docker compose ps` until `app` is `healthy`.

Things that change for your users and scripts:

- Every existing account is converted at its next sign-in (unless you set a cutoff date in the past, see above).
- The old sign-up and password reset requests are gone. Scripts that call them must be removed.
- There is no way back to storing plain password hashes.

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

## Going back to an older version

!!! danger "Do not go back to a version without password protection once accounts are converted"
    Converted accounts have no old-style password and cannot sign in with an older version. They would have to use "Forgot password" (or you run `app:user:set-password`). Before any rollback, run `app:opaque:status` and take a backup. After `app:opaque:retire-legacy --force` a rollback affects every account.

## Watching it run

The app logs `opaque.*` lines (user id only, never address or password): `opaque.login.success`, `opaque.login.failure`, `opaque.legacy_login.success` and `.failure`, `opaque.upgrade.success` and `opaque.identify.reset_required`. In production only errors are logged (with the few lines before them, see [Operations](operations.md)), so these lines show up mostly around problems.

- Wrong passwords are not visible on the server: the browser notices them itself. `opaque.login.failure` counts only damaged, expired or replayed sign-in attempts.
- For progress and counts use `app:opaque:status`, not the log.
- **Alert on error log entries about a record with an unknown key id.** They mean a key was removed while accounts still use it; those users must use "Forgot password".

## Command reference

| Command | Purpose |
|---|---|
| `app:opaque:generate-keys` | Print new keys. Stores nothing. |
| `app:opaque:check` | Validate the keys and the cutoff date. Exits with an error if the setup is missing or invalid. Warns about unused keys. |
| `app:opaque:status [--json]` | Count accounts per method and show the migrated share. |
| `app:opaque:notify-legacy [--dry-run] [--limit=N]` | Cutoff reminder mails (daily cron). |
| `app:opaque:retire-legacy [--force]` | Delete remaining old hashes after the cutoff. |

## Creating users from the command line

By default, the user commands do not set a password. They create the account without one and print a **one-time link** (valid 60 minutes) where the user sets a password in the browser:

```bash
php bin/console app:user:create --name="Anna" --email=anna@example.com
php bin/console app:user:set-password anna@example.com --link
```

`app:user:set-password` also ends all sessions of that user. Treat the link like a password and give it only to its owner. Passing `--password` or `--password-stdin` still works but creates an old-style account that is converted at its first sign-in, and prints a warning. After the cutoff it needs `--force-legacy`.

## Settings at a glance

| Variable | Default | Meaning |
|---|---|---|
| `OPAQUE_OPRF_SEED`, `OPAQUE_SERVER_PRIVATE_KEY` | | Key set `1`. **Required** (or use `OPAQUE_KEYS`). |
| `OPAQUE_KEYS`, `OPAQUE_ACTIVE_KEY_ID` | | More key sets and the active id (default `1`). |
| `OPAQUE_LEGACY_CUTOFF` | empty | Date after which unconverted accounts must reset their password. Empty: no end date. |

More settings are listed in the [configuration reference](configuration/reference.md); daily jobs are in [Operations](operations.md).
