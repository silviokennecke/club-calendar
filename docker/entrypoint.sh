#!/bin/bash
# Entrypoint of the Club Calendar image.
#   serve (default)  prepare, migrate, then run PHP-FPM + Caddy
#   anything else    executed as is, e.g. `php bin/console doctrine:fixtures:load`
#
# Required:  APP_SECRET, JWT_REFRESH_SECRET, DATABASE_URL, APP_URL (public URL, e.g. https://cal.example.com),
#            WEBAUTHN_RP_NAME
# Optional:  FRONTEND_URL / BACKEND_URL / WEBAUTHN_RP_ID (derived from APP_URL), MAILER_DSN, MAILER_FROM, MAPBOX_TOKEN,
#            GOOGLE_*/MICROSOFT_*/APPLE_* OAuth settings, SYMFONY_TRUSTED_PROXIES (behind a TLS proxy, e.g. PRIVATE_SUBNETS),
#            RUN_MIGRATIONS (default 1), MIGRATION_RETRIES (default 15), PORT (default 8080), LEGAL_DOCUMENTS_PATH
# JWT keys:  JWT_PRIVATE_KEY / JWT_PUBLIC_KEY (paths) or keys in /var/www/html/config/jwt (mount a volume there,
#            otherwise a new keypair is generated on every container start and sessions are lost).
# Legal documents: mount your legal Markdown files (imprint.md, privacy.md, terms.md) at /var/www/html/legal or set
#                  LEGAL_DOCUMENTS_PATH to another directory (see backend/legal/README.md).
set -euo pipefail

APP_DIR=/var/www/html

log() { echo "[entrypoint] $*" >&2; }

cd "$APP_DIR"

export MAILER_DSN="${MAILER_DSN:-null://null}"
export MAILER_FROM="${MAILER_FROM:-Club Calendar <noreply@localhost>}"
export GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"
export MICROSOFT_CLIENT_ID="${MICROSOFT_CLIENT_ID:-}" MICROSOFT_CLIENT_SECRET="${MICROSOFT_CLIENT_SECRET:-}"
export APPLE_CLIENT_ID="${APPLE_CLIENT_ID:-}" APPLE_CLIENT_SECRET="${APPLE_CLIENT_SECRET:-}"

if [ "${1:-serve}" != "serve" ]; then
    exec "$@"
fi

missing=()
for var in APP_SECRET JWT_REFRESH_SECRET DATABASE_URL APP_URL; do
    [ -n "${!var:-}" ] || missing+=("$var")
done
if [ ${#missing[@]} -gt 0 ]; then
    log "missing required environment variables: ${missing[*]}"
    exit 1
fi

# JWT keypair
if [ ! -s "$JWT_PRIVATE_KEY" ]; then
    log "no JWT keypair found, generating one in config/jwt (mount a volume there to keep it across restarts)"
    php bin/console lexik:jwt:generate-keypair --skip-if-exists --no-interaction
fi

# Database migrations
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
    retries="${MIGRATION_RETRIES:-15}"
    for ((attempt = 1; ; attempt++)); do
        if php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration; then
            break
        fi
        if [ "$attempt" -ge "$retries" ]; then
            log "migrations failed after $attempt attempts"
            exit 1
        fi
        log "migration attempt $attempt failed (database not ready?), retrying in 2s"
        sleep 2
    done
fi

# Sync legal documents from the mounted directory
if ! php bin/console app:legal:sync --no-interaction 2>&1 | tee /dev/stderr; then
    log "WARNING: legal document sync failed (non-fatal, documents may be out of date)"
fi

# Run PHP-FPM + Caddy; if one exits, take the other down so the container restarts
php-fpm -F &
fpm_pid=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

shutdown() {
    kill -TERM "$fpm_pid" "$caddy_pid" 2>/dev/null || true
}
trap shutdown TERM INT

set +e
wait -n "$fpm_pid" "$caddy_pid"
status=$?
shutdown
wait
exit "$status"
