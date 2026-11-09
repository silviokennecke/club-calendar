# How configuration works

Club Calendar is configured almost entirely with **environment variables**. Every variable is listed in the [reference](reference.md). You only need to set the few required ones; everything else has a sensible default.

## Where to set variables

=== "Docker"

    Put the variables in the `.env` file next to your `docker-compose.yml` (the compose file loads it through `env_file`).

    ```ini
    APP_URL=https://calendar.example.com
    MAILER_DSN=smtp://user:pass@mail.example.com:587
    ```

    To apply a change, recreate the container:

    ```bash
    docker compose up -d
    ```

    A plain `restart` is not enough: the container only reads its environment when it is created.

=== "Without Docker"

    Put the variables in `backend/.env.local` (never edit `backend/.env`, and keep `.env.local` out of version control). Then clear the cache:

    ```bash
    cd backend
    php bin/console cache:clear
    ```

    If you set variables in the web server or PHP-FPM pool instead, restart PHP-FPM as well.

### Precedence

If a variable is set in several places, the first one wins:

1. real environment variables (Docker `environment:`, shell, PHP-FPM pool)
2. `backend/.env.local`
3. `backend/.env`

## Value formats

| Type | Format |
|---|---|
| Boolean | `true` or `false` (`1` and `0` also work) |
| Number | Plain integer, no unit. Durations are in **seconds**. |
| List | Comma-separated, e.g. `claude,openai,gemini` |
| Text with spaces or special characters | Put it in double quotes, e.g. `MAILER_FROM="Club Calendar <noreply@example.com>"` |

!!! tip "Special characters in passwords"
    In `DATABASE_URL` and `MAILER_DSN`, characters such as `@`, `:`, `/` and `%` in a password must be URL-encoded (`@` becomes `%40`).

## Addresses: one URL is enough

The normal setup serves the app and the API from **one address**. Set only `APP_URL` to the public address, including `https://`:

```ini
APP_URL=https://calendar.example.com
```

`FRONTEND_URL`, `BACKEND_URL` and `WEBAUTHN_RP_ID` then default to it. Set them only for a *split setup*, where the web app and the API run on different addresses. In that case also see [Security](../security.md) for the extra settings the split needs.

All links in e-mails and redirects are built from these URLs, never from the address a visitor typed.

### Trusted hosts

The app answers only requests for known host names; everything else gets an error 400. Accepted are the hosts of `APP_URL`, `FRONTEND_URL` and `BACKEND_URL`, plus `localhost`, `127.0.0.1` and `[::1]` (needed for health checks).

If your site is reachable under another name, for example a `www` alias, list it:

```ini
TRUSTED_HOSTS=www.example.com
```

### Behind a reverse proxy

The Docker image speaks plain HTTP on port 8080 and does not handle HTTPS itself. If you run a reverse proxy or load balancer in front (the example Compose setup does), set `SYMFONY_TRUSTED_PROXIES` to the proxy addresses, for example `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`. Without it, the app sees every visitor as coming from the proxy, and the [rate limits](../security.md) apply to all visitors together.

## Checking your configuration

| Command | What it checks |
|---|---|
| `php bin/console app:opaque:check` | The [password protection](../password-protection.md) settings. Fails only when it is enabled and the keys are missing or invalid. |
| `php bin/console app:legal:sync` | Reads your [legal texts](../legal.md) and reports missing or invalid ones. |

With Docker, run commands inside the container:

```bash
docker compose exec app php bin/console app:opaque:check
```

(Replace `app` with the name of your service.) At every start the container checks the required variables and the password protection keys and stops if they are missing or invalid. A failed legal text sync only logs a warning. Read the container log if it stops right after starting.

## Other files you may touch

| File | Purpose | When |
|---|---|---|
| `imprint.md`, `privacy.md`, `terms.md` in `/data/legal` (Docker) or `backend/legal/` | Your legal texts | Always, before going public. See [Legal](../legal.md). |
| `/data/config/` (Docker) or `backend/config/jwt/` | Signing keys for sign-in | Keep them on a volume. See [Operations](../operations.md). |
| `docker/Caddyfile` or `backend/public/.htaccess` | Web server rules and security headers | Rarely. See [Security](../security.md). |
| `backend/config/packages/rate_limiter.yaml` | Fine-grained rate limits | Only for limits not covered by a variable. |

!!! warning "Changes to files inside the image are lost on update"
    In Docker, anything you edit inside the container is replaced when you pull a new image. To keep a changed file, mount your own copy over the original path:

    ```yaml
    services:
      app:
        volumes:
          - ./my-rate_limiter.yaml:/var/www/html/config/packages/rate_limiter.yaml:ro
    ```

    This is an advanced step. Your copy no longer receives upstream changes, so after each update compare it with the new original and merge differences. Prefer an environment variable whenever one exists.

In the Docker image, persistent data lives under `/data`: `/data/config` (signing keys), `/data/legal` (legal texts) and `/data/cache` (can be rebuilt). The example Compose file mounts the first two.
