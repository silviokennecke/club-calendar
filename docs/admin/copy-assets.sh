#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target="$repo_root/docs/admin/docs/assets"

mkdir -p "$target"
cp "$repo_root/frontend/public/logo.svg" "$repo_root/frontend/public/favicon.svg" "$target/"
