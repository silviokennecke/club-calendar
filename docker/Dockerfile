# syntax=docker/dockerfile:1
#
# Club Calendar - one image: Caddy serves the built SPA and proxies /api/* to PHP-FPM (Symfony),
# so frontend and API share one origin. Build from the repo root:
#
#   docker build -f docker/Dockerfile -t club-calendar .
#
# Configuration happens at runtime (see docker/entrypoint.sh); the SPA uses its own origin for API
# calls, so one image works for any domain.

ARG PHP_VERSION=8.4
ARG NODE_VERSION=22
ARG CADDY_VERSION=2

# ── Stage 1: PHP dependencies (no dev) ───────────────────────────────────────
# Build stages run on the build host's platform (their output is architecture independent)
FROM --platform=$BUILDPLATFORM composer:2 AS backend-vendor
WORKDIR /app/backend
COPY backend/composer.json backend/composer.lock ./
# Scripts (cache:clear, assets:install) need the full app and run in the final stage instead
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-progress --no-interaction
COPY backend/ ./
# fixtures need a dev-only bundle and are not meant for production
RUN rm -rf src/DataFixtures \
    && composer dump-autoload --no-dev --classmap-authoritative --no-scripts --no-interaction

# ── Stage 2: mail templates + frontend (Vite builds into backend/public) ─────
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS frontend-build
WORKDIR /build
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts
COPY backend/templates/email backend/templates/email
RUN npm run build:mail -w backend
COPY frontend frontend
# Empty = the SPA talks to the API on its own origin, so the image is domain-independent
RUN npm run build -w frontend

# ── Stage 3: Caddy binary ────────────────────────────────────────────────────
FROM caddy:${CADDY_VERSION}-alpine AS caddy

# ── Stage 4: runtime ─────────────────────────────────────────────────────────
FROM php:${PHP_VERSION}-fpm-alpine AS runtime

COPY --from=ghcr.io/mlocati/php-extension-installer /usr/bin/install-php-extensions /usr/local/bin/
RUN apk add --no-cache bash tini \
    && install-php-extensions pdo_mysql intl opcache \
    && rm -f /usr/local/bin/install-php-extensions \
    && mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
    # own pool config, runs unprivileged (no user/group directive)
    && rm -f /usr/local/etc/php-fpm.d/www.conf /usr/local/etc/php-fpm.d/www.conf.default /usr/local/etc/php-fpm.d/zz-docker.conf

COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY docker/php.ini "$PHP_INI_DIR/conf.d/zz-app.ini"
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/app.conf
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV APP_ENV=prod \
    APP_DEBUG=0 \
    PORT=8080 \
    XDG_DATA_HOME=/tmp/caddy-data \
    XDG_CONFIG_HOME=/tmp/caddy-config

WORKDIR /var/www/html

COPY --from=backend-vendor --chown=www-data:www-data /app/backend/ ./
COPY --from=frontend-build --chown=www-data:www-data /build/backend/public/ ./public/
COPY --from=frontend-build --chown=www-data:www-data /build/backend/templates/email/verify_email.html.twig templates/email/

# Symfony runtime needs a .env; real configuration comes from environment variables.
# The cache is warmed at build time with the dummy values from docker/build.env (not kept in the image).
RUN --mount=type=bind,source=docker/build.env,target=/tmp/build.env \
    printf 'APP_ENV=prod\nAPP_DEBUG=0\n' > .env \
    && mkdir -p var config/jwt \
    && set -a && . /tmp/build.env && set +a \
    && php bin/console cache:warmup --no-interaction \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chown -R www-data:www-data .env var config/jwt public

USER www-data
EXPOSE 8080
VOLUME ["/var/www/html/config/jwt"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -sf "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["serve"]
