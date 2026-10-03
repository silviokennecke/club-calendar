#!/usr/bin/env bash
# Build the project and deploy it to a server over SSH/rsync.
#
#   ./deploy.sh [target] [--dry-run] [--skip-build]
#
# Targets are configured in ./.env (see .env.example) or via real environment
# variables, so the same script runs locally and in a pipeline.
#
# What it does:
#   1. composer install --no-dev + MJML compile in a staging copy of backend/
#   2. vite build of the frontend into the staging copy's public/ dir
#   3. rsync the staging copy to the server (var/, .env.local and JWT keys are kept)
#   4. on the server: migrations, cache warmup
# Nothing in your working tree (vendor/, frontend/dist, ...) is touched.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE="$ROOT/.deploy"
DRY_RUN=0
SKIP_BUILD=0
TARGET=""

die() { echo "✖ $*" >&2; exit 1; }
log() { echo "▸ $*"; }

# Load KEY=VALUE pairs from .env without overriding variables that are already set
load_env() {
  [ -f "$1" ] || return 0
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    key="${key#export }"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ "$val" == \"*\" ]]; then val="${val#\"}"; val="${val%\"}"
    elif [[ "$val" == \'*\' ]]; then val="${val#\'}"; val="${val%\'}"; fi
    [ -z "${!key+x}" ] && export "$key=$val"
  done < "$1"
  return 0
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $arg" ;;
    *) TARGET="$arg" ;;
  esac
done

load_env "$ROOT/.env"
TARGET="${TARGET:-${DEPLOY_DEFAULT_TARGET:-}}"
[ -n "$TARGET" ] || die "no target given and DEPLOY_DEFAULT_TARGET is not set (known: ${DEPLOY_TARGETS:-none})"

PREFIX="DEPLOY_$(echo "$TARGET" | tr '[:lower:]-' '[:upper:]_')_"
get() { local n="${PREFIX}$1"; echo "${!n:-${2:-}}"; }

SSH_TARGET="$(get SSH)"; REMOTE_PATH="$(get PATH)"; SITE_URL="$(get URL)"
SSH_PORT="$(get SSH_PORT 22)"; SSH_KEY="$(get SSH_KEY)"; REMOTE_PHP="$(get PHP php)"
ENV_FILE="$(get ENV_FILE)"; MIGRATE="$(get MIGRATE 1)"

[ -n "$SSH_TARGET" ]  || die "${PREFIX}SSH is not set"
[ -n "$REMOTE_PATH" ] || die "${PREFIX}PATH is not set"
[ -n "$SITE_URL" ]    || die "${PREFIX}URL is not set"
case "$REMOTE_PATH" in /?*) ;; *) die "${PREFIX}PATH must be an absolute path" ;; esac
if [ -n "$ENV_FILE" ]; then
  case "$ENV_FILE" in /*) ;; *) ENV_FILE="$ROOT/$ENV_FILE" ;; esac
  [ -f "$ENV_FILE" ] || die "${PREFIX}ENV_FILE not found: $ENV_FILE"
fi

SSH_CMD=(ssh -p "$SSH_PORT" -o BatchMode=yes)
[ -n "$SSH_KEY" ] && SSH_CMD+=(-i "$SSH_KEY")
remote() { "${SSH_CMD[@]}" "$SSH_TARGET" "$@"; }
RSYNC_SSH="${SSH_CMD[*]}"

log "Target: $TARGET ($SSH_TARGET:$REMOTE_PATH → $SITE_URL)$([ "$DRY_RUN" = 1 ] && echo " [dry-run]")"

if [ "$SKIP_BUILD" = 0 ]; then
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  [ -d "$ROOT/node_modules" ] || { log "Installing npm dependencies"; (cd "$ROOT" && npm ci); }

  log "Staging backend"
  rsync -a \
    --exclude='/.env' --exclude='/.env.*' --exclude='/var/' --exclude='/vendor/' \
    --exclude='/node_modules/' --exclude='/tests/' --exclude='/.phpunit.cache/' \
    --exclude='/.php-cs-fixer.*' --exclude='/phpunit*' --exclude='/phpstan*' \
    --exclude='/compose.override.*' --exclude='/config/jwt/*.pem' \
    --exclude='/public/index.html' --exclude='/public/assets/' \
    "$ROOT/backend/" "$STAGE/backend/"
  # Symfony's runtime needs a .env; real secrets live in .env.local / server env
  printf 'APP_ENV=prod\nAPP_DEBUG=0\n' > "$STAGE/backend/.env"

  log "Installing PHP dependencies (no-dev)"
  (cd "$STAGE/backend" && composer install --no-dev --optimize-autoloader --no-interaction --no-scripts)

  log "Compiling mail templates"
  (cd "$ROOT" && npx --no-install mjml backend/templates/email/verify_email.mjml \
    -o "$STAGE/backend/templates/email/verify_email.html.twig")

  log "Building frontend"
  (cd "$ROOT" && VITE_API_URL="${SITE_URL%/}" npm run build -w frontend -- \
    --outDir "$STAGE/frontend-dist" --emptyOutDir)

  log "Moving frontend into backend/public"
  rsync -a "$STAGE/frontend-dist/" "$STAGE/backend/public/"
  [ -f "$STAGE/backend/public/index.html" ] || die "frontend build produced no index.html"
  [ -f "$STAGE/backend/public/.htaccess" ] || die "backend/public/.htaccess is missing"
else
  [ -d "$STAGE/backend" ] || die "--skip-build needs a previous build in .deploy/"
  log "Skipping build, reusing .deploy/backend"
fi

RSYNC_FLAGS=(-az --delete --human-readable --stats -e "$RSYNC_SSH"
  --exclude='/var/' --exclude='/.env.local' --exclude='/config/jwt/*.pem')
[ "$DRY_RUN" = 1 ] && RSYNC_FLAGS+=(--dry-run --itemize-changes)

if [ "$DRY_RUN" = 0 ]; then
  remote "mkdir -p '$REMOTE_PATH/var'"
else
  remote "test -d '$REMOTE_PATH'" || log "(remote path does not exist yet)"
fi

log "Uploading"
rsync "${RSYNC_FLAGS[@]}" "$STAGE/backend/" "$SSH_TARGET:$REMOTE_PATH/" | tail -n 30

if [ "$DRY_RUN" = 1 ]; then
  log "Dry run finished, nothing changed on the server."
  exit 0
fi

if [ -n "$ENV_FILE" ]; then
  log "Uploading $PREFIX""ENV_FILE as .env.local"
  rsync -az -e "$RSYNC_SSH" --chmod=F600 "$ENV_FILE" "$SSH_TARGET:$REMOTE_PATH/.env.local"
else
  remote "test -f '$REMOTE_PATH/.env.local'" \
    || echo "⚠ no .env.local on the server and no ${PREFIX}ENV_FILE set — config must come from real env vars"
fi
remote "test -f '$REMOTE_PATH/config/jwt/private.pem'" \
  || echo "⚠ $REMOTE_PATH/config/jwt/private.pem missing on the server — generate the JWT keys (bin/console lexik:jwt:generate-keypair)"

log "Running post-deploy steps on the server"
remote "cd '$REMOTE_PATH' && export APP_ENV=prod APP_DEBUG=0 && set -e
  [ '$MIGRATE' != 1 ] || '$REMOTE_PHP' bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration
  '$REMOTE_PHP' bin/console cache:clear --no-warmup
  '$REMOTE_PHP' bin/console cache:warmup"

log "Deployed $TARGET → $SITE_URL"
