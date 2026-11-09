#!/usr/bin/env bash
# Deletes GHCR versions whose tags are all pr-<N> of pull requests closed > 30 days ago.
# Env: OWNER, REPO (owner/name), PACKAGE, DRY_RUN (true|false), GH_TOKEN.
# Optional: VERSIONS_FILE (fake JSON array for tests), CUTOFF (ISO UTC).
set -euo pipefail

: "${PACKAGE:=club-calendar}"
: "${DRY_RUN:=false}"
errf=$(mktemp)
CUTOFF="${CUTOFF:-$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)}"

if [[ -n "${VERSIONS_FILE:-}" ]]; then
  versions=$(cat "$VERSIONS_FILE")
else
  versions=$(gh api --paginate "/users/${OWNER}/packages/container/${PACKAGE}/versions?per_page=100" | jq -s 'add // []')
fi

# Only versions carrying tags, all of them pr-<N>: untagged ones (including the
# children of multi-arch manifests) are left to the untagged job, which protects them.
candidates=$(jq -r '.[]
  | select((.metadata.container.tags | length) > 0)
  | select(all(.metadata.container.tags[]; test("^pr-[0-9]+$")))
  | [.id, .created_at, (.metadata.container.tags | join(","))] | @tsv' <<<"$versions")

qualifies() { # $1 = PR number, $2 = version created_at; exit 0 = tag may be removed
  local n=$1 created=$2 out
  if out=$(gh api "repos/${REPO}/pulls/${n}" 2>"$errf"); then
    local state closed_at
    state=$(jq -r '.state' <<<"$out")
    closed_at=$(jq -r '.closed_at // empty' <<<"$out")
    [[ "$state" == "closed" && -n "$closed_at" && "$closed_at" < "$CUTOFF" ]]
  elif grep -q 'HTTP 404' "$errf"; then
    [[ "$created" < "$CUTOFF" ]]
  else
    echo "PR #${n}: lookup failed, keeping: $(cat "$errf")" >&2
    return 1
  fi
}

while IFS=$'\t' read -r id created tags; do
  [[ -z "${id:-}" ]] && continue
  ok=true
  IFS=',' read -ra list <<<"$tags"
  for t in "${list[@]}"; do
    qualifies "${t#pr-}" "$created" || { ok=false; break; }
  done
  if [[ "$ok" != true ]]; then
    echo "keep   version ${id} (${tags})"
  elif [[ "$DRY_RUN" == true ]]; then
    echo "would delete version ${id} (${tags})"
  else
    echo "delete version ${id} (${tags})"
    gh api -X DELETE "/users/${OWNER}/packages/container/${PACKAGE}/versions/${id}"
  fi
done <<<"$candidates"
