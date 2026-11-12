# Hosting without Docker

The recommended way to run Club Calendar is the Docker image (see [Quick start](quick-start.md)). If you prefer your
own web server, this page shows how. You need to be comfortable with PHP hosting.

## Requirements

| What | Details |
|---|---|
| PHP | 8.4 with PHP-FPM (or mod_php) |
| PHP extensions | `ctype`, `dom`, `gd`, `iconv`, `intl`, `mbstring`, `pdo_mysql`, `opcache` (recommended) |
| Database | MySQL 8 or MariaDB |
| Web server | Apache with `mod_rewrite` and `mod_headers`, or nginx |
| Build machine | Node.js 22 and Composer (the server itself does not need Node.js) |

`gd` and `intl` are needed for the PDF export.

!!! tip
    You can build on a separate machine and upload the result. Only PHP, the web server and the database must run
    on the server.

## Build

From the repository root:

```bash
npm install
npm run build
```

This installs PHP packages without development tools (`composer install --no-dev`), compiles the e-mail
templates and builds the web app into `backend/public/`.

The **document root of your web server is `backend/public/`**. Everything else (`backend/src`, `backend/config`,
`backend/var`, ...) must stay outside the web root or be unreachable.

## First setup

Do these steps in the `backend/` directory.

1. **Create the settings file.** Copy `.env.example` to `.env.local` and fill in at least `APP_ENV=prod`,
   `APP_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL` and `APP_URL`. All settings are described in
   [How configuration works](configuration/index.md) and the [Reference](configuration/reference.md). Keep this file
   outside of release folders if you deploy by replacing folders.
2. **Create the login keys.**

    ```bash
    php bin/console lexik:jwt:generate-keypair
    ```

    The keys end up in `config/jwt/`. Keep them between updates and [back them up](operations.md).
3. **Create the database tables.**

    ```bash
    php bin/console doctrine:migrations:migrate --no-interaction
    ```
4. **Warm up the cache** and make `var/` writable for the PHP user:

    ```bash
    APP_ENV=prod php bin/console cache:clear
    ```
5. **Encrypt the stored secrets** (feed and personal calendar secrets; safe to repeat, also after every update):

    ```bash
    php bin/console app:secrets:rotate
    ```
6. **Load the legal documents** (if you provide them, see [Legal documents](legal.md)):

    ```bash
    php bin/console app:legal:sync
    ```
7. **Create the first user** (see [Command-line tools](operations.md)).

## Web server

The web server has three jobs:

- send everything under `/api/` and the OAuth discovery addresses to PHP (`index.php`),
- serve the web app (`index.html`) for every other address that is not a real file, so that links and page reloads
  work,
- send the security headers and keep private files private.

=== "Apache"

    The file `backend/public/.htaccess` already does all of this. You only need to make sure that it is read:

    - `mod_rewrite` and `mod_headers` are enabled,
    - `AllowOverride` for the document root includes at least `FileInfo`, `Limit` and `Indexes`
      (`AllowOverride All` is simplest). Without it the rules are ignored or the site answers with an error,
    - PHP runs for `index.php` (PHP-FPM via `proxy_fcgi` or mod_php).

    ```apache
    <VirtualHost *:80>
        ServerName cal.example.com
        DocumentRoot /var/www/club-calendar/backend/public
        <Directory /var/www/club-calendar/backend/public>
            AllowOverride All
            Require all granted
        </Directory>
        <FilesMatch "\.php$">
            SetHandler "proxy:unix:/run/php/php8.4-fpm.sock|fcgi://localhost"
        </FilesMatch>
    </VirtualHost>
    ```

    **HSTS.** The `.htaccess` sends `Strict-Transport-Security` only for HTTPS requests (also when a proxy in front
    sets `X-Forwarded-Proto: https`). Do not add `includeSubDomains` or `preload` until all your subdomains
    support HTTPS.

    **Directory listings.** The `.htaccess` deliberately has no `Options -Indexes` line (it would cause a server
    error under a restrictive `AllowOverride`). With `mod_rewrite`, directory addresses such as `/assets/` fall
    through to the web app and are never listed.

=== "nginx"

    nginx does not read `.htaccess`. This is an **example to adapt** (paths, socket, server name, TLS) that does the
    same as the Apache file and the Docker image's Caddy configuration.

    ```nginx
    server {
        listen 80;
        server_name cal.example.com;
        root /var/www/club-calendar/backend/public;
        index index.html;
        autoindex off;
        client_max_body_size 16m;

        # Security headers (same values as the Docker image)
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'sha256-+A14ONesVdzkn6nr37Osn+rUqNz4oFGZFDbLXrlae04='; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; child-src blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000" always;

        # Private files, but keep the OAuth discovery documents reachable
        location ~ /\.(?!well-known) { deny all; }
        location ~ \.(env|pem|log|map)$ { deny all; }
        location = /index.php { return 404; }

        # Feed pages and feed API: never send a Referer.
        # add_header is not inherited into nested blocks: repeat all headers here.
        location ~ ^/(api/)?feed/ {
            add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'sha256-+A14ONesVdzkn6nr37Osn+rUqNz4oFGZFDbLXrlae04='; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; child-src blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
            add_header X-Content-Type-Options "nosniff" always;
            add_header X-Frame-Options "DENY" always;
            add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()" always;
            add_header Cross-Origin-Opener-Policy "same-origin" always;
            add_header Referrer-Policy "no-referrer" always;
            add_header Strict-Transport-Security "max-age=31536000" always;
            try_files $uri /index.html;
            location ^~ /api/feed/ { try_files /nonexistent @php; }
        }

        # MCP endpoint: do not buffer, allow long connections
        location = /api/mcp {
            fastcgi_pass unix:/run/php/php8.4-fpm.sock;
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $document_root/index.php;
            fastcgi_buffering off;
            fastcgi_read_timeout 3600s;
        }

        # API, OAuth/MCP discovery documents and the change-password redirect
        location ~ ^/(api/|\.well-known/(oauth-(authorization-server|protected-resource)|change-password)) {
            fastcgi_pass unix:/run/php/php8.4-fpm.sock;
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $document_root/index.php;
            fastcgi_read_timeout 90s;
        }

        location @php {
            fastcgi_pass unix:/run/php/php8.4-fpm.sock;
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $document_root/index.php;
        }

        # Web app: real files, otherwise index.html
        location /assets/ {
            add_header Cache-Control "public, max-age=31536000, immutable";
            add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'sha256-+A14ONesVdzkn6nr37Osn+rUqNz4oFGZFDbLXrlae04='; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; child-src blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
            add_header X-Content-Type-Options "nosniff" always;
            add_header X-Frame-Options "DENY" always;
            add_header Cross-Origin-Opener-Policy "same-origin" always;
            add_header Referrer-Policy "strict-origin-when-cross-origin" always;
            try_files $uri =404;
        }
        location / {
            add_header Cache-Control "no-cache";
            add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'sha256-+A14ONesVdzkn6nr37Osn+rUqNz4oFGZFDbLXrlae04='; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; child-src blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
            add_header X-Content-Type-Options "nosniff" always;
            add_header X-Frame-Options "DENY" always;
            add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()" always;
            add_header Cross-Origin-Opener-Policy "same-origin" always;
            add_header Referrer-Policy "strict-origin-when-cross-origin" always;
            add_header Strict-Transport-Security "max-age=31536000" always;
            try_files $uri /index.html;
        }
    }
    ```

    Things to check in your adaptation:

    - **`add_header` is not inherited.** If a `location` block sets any header, it loses all headers of the
      `server` block, so the full set is repeated above. Keep the header values identical everywhere.
    - **Feeds:** `/feed/*` (web page) and `/api/feed/*` (API) must send `Referrer-Policy: no-referrer`. The feed
      block above shows the web page; make sure your `/api/feed/` requests reach PHP **and** carry that header
      (the simplest way is a separate `location ^~ /api/feed/` block that repeats the PHP settings and all
      headers).
    - **The Content-Security-Policy must be the same string** as in the example, including the style hash. When the app gets updated, compare it with the
      `Caddyfile` of the new release.
    - **`/.well-known/oauth-*` and `/api/mcp`** must go to PHP, or AI assistants (MCP clients) cannot find and use
      the server. Do not block `.well-known` with a dotfile rule.
    - **`/.well-known/change-password`** must go to PHP too. It sends password managers to the password section of the profile page.
    - **TLS** is not shown. Terminate it here or in front, and send the HSTS header only over HTTPS.
    - **Timeouts** for `/api/` should be at least 60 seconds (PDF export).

!!! warning "Test your server"
    After setup, open `https://your-domain/api/health` (should answer `{"status":"ok"}`), reload a deep
    link such as `/login`, and check that `https://your-domain/.env` and `https://your-domain/assets/` are not
    served.

## PHP settings worth knowing

| Setting | Recommended | Why |
|---|---|---|
| `memory_limit` | `256M` | An import of 5000 events needs about 130 MB extra. PDF export raises the limit itself to 512M for that request |
| `post_max_size` | `16M` | Imports send 2 to 3 MB |
| `max_execution_time` | at least 60 s for `/api/` | PDF export raises it itself to 60 s; proxy timeouts must allow it too |
| `display_errors` | `Off` | Never show errors to visitors |
| `opcache.enable` | `1` | Faster responses |
| `date.timezone` | `UTC` | Consistent times |

The user running PHP must be able to write to `backend/var/` (cache; the PDF export stores fonts and temporary files in `backend/var/cache`; the location database for security notices is kept in `backend/var/geoip` by default). The build does not publish source maps. With PHP-FPM,
pass the environment through (`clear_env = no`) if you set settings as real environment variables instead of
`.env.local`.

## Scheduled tasks

Set up the jobs listed under [Scheduled tasks](operations.md). They are the same as with Docker, without the `docker compose exec` part.

## Updating

See [Updating](operations.md).

The list of known browsers (shown in sign-in notification mails) can be refreshed between releases, see [Browser recognition](operations.md#browser-recognition).
