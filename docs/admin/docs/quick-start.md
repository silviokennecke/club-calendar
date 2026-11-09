# Quick start (Docker Compose)

This sets up Club Calendar with a database and automatic HTTPS on one server.

## Requirements

- A server with Docker and Docker Compose (v2).
- A domain name pointing at the server.
- Ports 80 and 443 open (only needed for the bundled proxy).
- An SMTP account for sending mail (confirmation codes, password resets, invitations).

## Install

1. **Create a directory** and open it:

    ```bash
    mkdir club-calendar && cd club-calendar
    ```

2. **Download the files** (details on the [examples page](examples/index.md)):

    ```bash
    BASE=https://silviokennecke.github.io/club-calendar/examples
    curl -fLO $BASE/docker-compose.yml
    curl -fLO $BASE/docker-compose.override.yml
    curl -fL $BASE/example.env -o .env
    ```

3. **Edit `.env`.** Set `APP_URL`, `APP_DOMAIN`, the mail settings, and replace every `change-me` with a random value (`openssl rand -hex 32`). Use a different value for each, except the two `OPAQUE_*` keys: generate those with the command in the file ([Password protection](password-protection.md#setting-up-the-keys)) and back them up, because the app does not start without them and cannot create them for you.

    !!! warning "Keep your secrets"
        Back up `.env`. Never commit it to a public repository.

4. **Add your legal documents** (imprint, privacy policy, terms). See [Legal documents](legal.md). Create the `legal` directory next to the compose file; without documents the app still starts.

    ```bash
    mkdir -p legal
    ```

5. **Start:**

    ```bash
    docker compose up -d
    ```

    On first start the app creates its login keys and the database tables. This usually takes under a minute.

6. **Check that it runs:**

    ```bash
    docker compose ps
    docker compose logs -f app
    ```

    `app` should become `healthy`. Then open your `APP_URL` in a browser. If `app` keeps restarting, the log names the missing setting.

## Create the first user

```bash
docker compose exec app php bin/console app:user:create --name "Your Name" --email you@example.com --language en
```

The command prints a one-time link to set a password (by default, or when you pass `--link`). Without `--password` and `--link` it asks for the password interactively, which needs a terminal. In scripts or without a terminal, use `--link`: it prints a one-time link, valid for 60 minutes, where you set the password. The address is marked as confirmed, so no mail is needed for this user.

!!! note "Mail is needed for everyone else"
    With the default `MAILER_DSN=null://null` the app runs but sends no mail, so sign-up confirmation codes and invitations do not work. Configure mail, see [Mail and maps](configuration/mail-and-maps.md).

!!! tip "Invitation-only installations"
    With `RESTRICT_REGISTRATION=true` nobody can register without a club invitation, so this command is the way to create the first user. After that, invite people from inside the app.

## Without the bundled proxy

If you already run a reverse proxy (nginx, Traefik, Caddy, a load balancer):

- Do not download `docker-compose.override.yml`.
- Point your proxy at `127.0.0.1:8080`, terminate HTTPS there, and send a `Strict-Transport-Security` header.
- Set `SYMFONY_TRUSTED_PROXIES` in `.env` to your proxy's address, otherwise all visitors share one address for rate limits.

More in [Security](security.md).

## Next steps

- [Configuration](configuration/index.md): mail, maps, single sign-on and all other settings
- [Legal documents](legal.md)
- [Security](security.md) and [Password protection](password-protection.md)
- [Operations](operations.md): updates, backups and cron jobs

## Updating

Change `APP_IMAGE_TAG` if needed, then `docker compose pull && docker compose up -d`. Database changes run automatically. See [Operations](operations.md) for backups and details.
