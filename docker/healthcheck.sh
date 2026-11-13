#!/bin/sh
# One health check for every role: all supervised programs RUNNING, plus the HTTP check where Caddy runs.
conf=/tmp/supervisor/supervisord.conf
# supervisorctl status exits non-zero when a program is not RUNNING
supervisorctl -c "$conf" status > /dev/null || exit 1
case "${ROLE:-all}" in
    worker) ;;
    *) curl -sf "http://127.0.0.1:${PORT:-8080}/api/health" > /dev/null || exit 1 ;;
esac
