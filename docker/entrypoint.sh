#!/bin/bash
# Entrypoint of the Club Calendar image.
#   serve (default)  prepare, then run supervisord with the programs of ROLE
#   anything else    executed as is, e.g. `php bin/console doctrine:fixtures:load`
#
# ROLE:      all (default: web + worker in one container), web (PHP-FPM + Caddy, prepares and migrates) or
#            worker (queue consumers + scheduler; waits for the web role to have migrated the database).
#            MESSENGER_WORKERS (default 2, 1..32) consumers of the async queue; SCHEDULER_ENABLED=false removes the
#            scheduler from this container (one is enough per cluster, the app lock guarantees uniqueness anyway).
# Required:  APP_SECRET, JWT_REFRESH_SECRET, DATABASE_URL, APP_URL (public URL, e.g. https://cal.example.com)
# Optional:  APP_NAME, WEBAUTHN_RP_NAME, FRONTEND_URL / BACKEND_URL / WEBAUTHN_RP_ID (derived from APP_URL), MAILER_DSN, MAILER_FROM, MAPBOX_TOKEN,
#            APP_SECRET_PREVIOUS (only while rotating APP_SECRET), GOOGLE_*/MICROSOFT_*/APPLE_* OAuth settings, SYMFONY_TRUSTED_PROXIES (behind a TLS proxy, e.g. PRIVATE_SUBNETS),
#            RESTRICT_REGISTRATION (default 0/false), MCP_ACCESS_TOKEN_TTL, MCP_REFRESH_TOKEN_LIFETIME,
#            MCP_REFRESH_TOKEN_ABSOLUTE_LIFETIME, MCP_REFRESH_TOKEN_REUSE_GRACE, MCP_ALLOWED_CLIENTS (MCP server, see backend/.env.example),
#            FEED_ICS_WINDOW_ENABLED, FEED_ICS_PAST_DAYS, FEED_ICS_FUTURE_MONTHS, FEED_ICS_MAX_EVENTS (public feed ICS window), FEED_RATE_LIMIT_PER_IP, FEED_RATE_LIMIT_PER_FEED (public feed rate limits), RUN_MIGRATIONS (default 1), MIGRATION_RETRIES (default 15), PORT (default 8080), LEGAL_DOCUMENTS_PATH
#            STORAGE_SOURCE (storage.local default | storage.s3), STORAGE_LOCAL_PATH, S3_ENDPOINT, S3_REGION, S3_KEY, S3_SECRET, S3_BUCKET, S3_PREFIX, S3_USE_PATH_STYLE,
#            S3_SSE_C_KEY, S3_SSE_C_KEY_PREVIOUS (file storage, see backend/.env.example)
#            MAXMIND_ACCOUNT_ID, MAXMIND_LICENSE_KEY (offline GeoIP for security notices; the entrypoint stores GeoLite2-City in the file storage when it is missing or older than 3 days)
# JWT keys:  JWT_PRIVATE_KEY / JWT_PUBLIC_KEY (paths; the image sets /data/config/*.pem, mount a volume at /data/config,
#            otherwise a new keypair is generated on every container start).
# Legal documents: mount your legal Markdown files (imprint.md, privacy.md, terms.md) at /data/legal (the image sets
#                  LEGAL_DOCUMENTS_PATH=/data/legal; set it to use another directory, see backend/legal/README.md).
#                  Or set LEGAL_IMPRINT_URL / LEGAL_PRIVACY_URL / LEGAL_TERMS_URL to an http(s) URL of an external document
#                  (used only when the Markdown file of that type is missing).
set -euo pipefail

APP_DIR=/var/www/html

log() { echo "[entrypoint] $*" >&2; }

cd "$APP_DIR"

export MAILER_DSN="${MAILER_DSN:-null://null}"
export MAILER_FROM="${MAILER_FROM:-${APP_NAME:-Club Calendar} <noreply@localhost>}"
export GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"
export MICROSOFT_CLIENT_ID="${MICROSOFT_CLIENT_ID:-}" MICROSOFT_CLIENT_SECRET="${MICROSOFT_CLIENT_SECRET:-}"
export APPLE_CLIENT_ID="${APPLE_CLIENT_ID:-}" APPLE_CLIENT_SECRET="${APPLE_CLIENT_SECRET:-}"

if [ "${1:-serve}" != "serve" ]; then
    exec "$@"
fi

ROLE="${ROLE:-all}"
case "$ROLE" in
    all | web | worker) ;;
    *) log "invalid ROLE '$ROLE' (allowed: all, web, worker)"; exit 1 ;;
esac

MESSENGER_WORKERS="${MESSENGER_WORKERS:-2}"
if ! [[ "$MESSENGER_WORKERS" =~ ^[0-9]+$ ]] || [ "$MESSENGER_WORKERS" -lt 1 ] || [ "$MESSENGER_WORKERS" -gt 32 ]; then
    log "invalid MESSENGER_WORKERS '$MESSENGER_WORKERS' (integer 1..32)"
    exit 1
fi
export MESSENGER_WORKERS

# Every role boots the same kernel, so all roles need the same core settings
missing=()
for var in APP_SECRET JWT_REFRESH_SECRET DATABASE_URL APP_URL; do
    [ -n "${!var:-}" ] || missing+=("$var")
done
if [ ${#missing[@]} -gt 0 ]; then
    log "missing required environment variables: ${missing[*]}"
    exit 1
fi

if [ "$ROLE" = "worker" ]; then
    # The web role owns migrations and the secret rotation; wait (bounded) until the schema is current
    retries="${MIGRATION_WAIT_RETRIES:-90}"
    for ((attempt = 1; ; attempt++)); do
        if php bin/console doctrine:migrations:up-to-date --no-interaction >/dev/null 2>&1; then
            log "database schema is up to date"
            break
        fi
        if [ "$attempt" -ge "$retries" ]; then
            log "database schema still not migrated after $attempt checks (is a web container running?)"
            exit 1
        fi
        log "waiting for database migrations ($attempt/$retries), retrying in 2s"
        sleep 2
    done
else
    # Initial page title from APP_NAME: render the SPA's index.html from the untouched build-time template (idempotent)
    if [ -f index.html.tpl ]; then
        if ! php -r '
            $v = trim((string) preg_replace("/[\p{Cc}\p{Cf}]+/u", "", (string) getenv("APP_NAME")));
            $v = trim(mb_substr($v, 0, 60));
            if ($v === "") { $v = "Club Calendar"; }
            $t = htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, "UTF-8");
            $h = file_get_contents("index.html.tpl");
            $o = "<title>Club Calendar</title>";
            if ($h === false || substr_count($h, $o) !== 1) { fwrite(STDERR, "title marker not found\n"); exit(1); }
            $tmp = "public/.index.html.tmp";
            if (file_put_contents($tmp, str_replace($o, "<title>" . $t . "</title>", $h)) === false || !rename($tmp, "public/index.html")) { exit(1); }
        '; then
            log "WARNING: could not set the page title from APP_NAME (non-fatal, the default title stays until the app loads)"
        fi
    fi

    # JWT keypair
    if [ ! -s "$JWT_PRIVATE_KEY" ]; then
        log "no JWT keypair found, generating one at $JWT_PRIVATE_KEY (mount a volume at $(dirname "$JWT_PRIVATE_KEY") to keep it across restarts)"
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
    if ! php bin/console app:legal:sync --no-interaction >&2; then
        log "WARNING: legal document sync failed (non-fatal, documents may be out of date)"
    fi

    # GeoLite2 City database for the location in security notices (only with a MaxMind licence key). Stored in the file
    # storage; the command skips the download while the stored file is younger than 3 days. The scheduler refreshes it weekly.
    if [ -n "${MAXMIND_LICENSE_KEY:-}" ]; then
        if ! php bin/console app:geoip:update --no-interaction >&2; then
            log "WARNING: GeoIP database update failed (non-fatal, locations stay empty or outdated)"
        fi
    fi

    # Encrypt stored feed and subscription secrets with the current APP_SECRET (legacy plaintext on upgrade, rotation)
    if ! php bin/console app:secrets:rotate --no-interaction >&2; then
        log "WARNING: app:secrets:rotate failed (non-fatal): some secrets could not be encrypted or decrypted; check APP_SECRET / APP_SECRET_PREVIOUS and run the command by hand"
    fi

    # Re-encrypt S3 objects with the current SSE-C key (a no-op unless STORAGE_SOURCE=storage.s3 with S3_SSE_C_KEY and
    # S3_SSE_C_KEY_PREVIOUS set; remove S3_SSE_C_KEY_PREVIOUS once it has succeeded)
    if ! php bin/console app:storage:rotate-key --no-interaction >&2; then
        log "WARNING: app:storage:rotate-key failed (non-fatal): some objects could not be re-encrypted; check S3_SSE_C_KEY / S3_SSE_C_KEY_PREVIOUS and run the command by hand"
    fi
fi

# Render the supervisord configuration for this role into /tmp (the image directory stays untouched)
SUPERVISOR_DIR=/tmp/supervisor
SUPERVISOR_SRC=/usr/local/share/supervisord
mkdir -p "$SUPERVISOR_DIR"
chmod 0700 "$SUPERVISOR_DIR"
conf="$SUPERVISOR_DIR/supervisord.conf"
cp "$SUPERVISOR_SRC/base.conf" "$conf"
if [ "$ROLE" != "worker" ]; then
    cat "$SUPERVISOR_SRC/web.conf" >> "$conf"
fi
if [ "$ROLE" != "web" ]; then
    cat "$SUPERVISOR_SRC/worker.conf" >> "$conf"
    case "${SCHEDULER_ENABLED:-true}" in
        0 | false | FALSE | False | no | off) log "scheduler disabled (SCHEDULER_ENABLED=${SCHEDULER_ENABLED})" ;;
        *) cat "$SUPERVISOR_SRC/scheduler.conf" >> "$conf" ;;
    esac
fi

log "starting supervisord (role $ROLE)"
exec supervisord -n -c "$conf"
