# Dependencies, Secrets & Config Security Audit

## Scope
Secrets and credentials in the working tree and git history, third-party dependency vulnerabilities (JS + PHP), and the security posture of local/CI configuration: `docker-compose.yml`, the GitHub Actions workflow, deploy helpers, and `.env*` files. Stack: Symfony 8.1 backend, React SPA frontend, single root `package-lock.json`.

## Method
- Gitleaks full-history scan (284 commits) using the repo's `.gitleaks.toml` allowlist; raw output in `.security-audit/gitleaks.json`
- Trivy `fs` scan via Docker (`--scanners vuln,secret`, skipping `vendor`, `node_modules`, `dist`, `.git`)
- `composer audit` for the PHP backend
- Manual review of `docker-compose.yml`, `.github/workflows/ci.yml`, `.deploy/askpass.sh`, all `.env*` files, and the JWT key wiring
- Pattern greps across the repo (AWS `AKIA…`, OpenAI `sk-…`, GitHub `ghp_…`, Slack `xox…`, PEM private-key blocks, `DEPLOY_PASSWORD`/`DEPLOY_KEY`)
- CVE findings cross-checked against the resolved versions and dependency chains in the root `package-lock.json`
- Audit made no repo modifications; note `.security-audit/` is not gitignored — do not commit its artifacts

## Date
2026-10-05

### SCAN-01 — JWT private key in working tree, untracked, not gitignored
**Severity:** HIGH
**Attack scope:** Authentication core — a leaked `private.pem` allows forging valid JWTs for any user, including administrators (full account takeover without any anomaly in the logs).
**Description:** `backend/config/jwt/private.pem` sits in the local working tree and is wired in via `backend/config/packages/lexik_jwt_authentication.yaml:3-4` (`JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`), consumed at lines 7 and 9 (`secret_key`, `pass_phrase`). The PEM is passphrase-protected, which mitigates casual exposure. The file is untracked and absent from the entire git history (verified with the gitleaks full-history scan and `git ls-files`), but there is no `.gitignore` entry covering `backend/config/jwt/`, so a single `git add -A` would commit the signing key.
**Affected parts:** `backend/config/jwt/private.pem` (untracked), `backend/config/packages/lexik_jwt_authentication.yaml:3-4,7,9`, `.gitignore` (no matching entry)
**Fix recommendation:**
1. Add `backend/config/jwt/` to `.gitignore` and verify with `git check-ignore backend/config/jwt/private.pem`.
2. Generate a fresh key pair and rotate (accept both public keys during the 15-min token-TTL overlap); distribute keys via deployment secrets instead of the checkout.
3. Keep the passphrase strong and separate from the key file (currently derived from `APP_SECRET`, see yaml line 2 — fine locally, use an independent secret in production).
**Notes:** Severity stays HIGH on impact (any-user token forgery) plus the missing accidental-commit guard; encryption lowers likelihood but not impact.

### SCAN-02 — Mapbox public token committed in git history (MapPicker.tsx)
**Severity:** MEDIUM
**Attack scope:** Mapbox billing/abuse — a `pk.` public token is client-side by design; a leaked token allows quota consumption under the `silviokennecke` Mapbox account (cost + rate limiting), not backend or user data.
**Description:** The full-history gitleaks scan found one secret: a Mapbox public token in `frontend/src/components/locations/MapPicker.tsx:8` (rule `generic-api-key`), introduced in commit `e0bbc0ab884755f61e8cb3070d1f96469d410244` (2026-06-12). The file was later removed from the tree, but the token `pk.eyJ1Ijoi…[REDACTED-ROTATE-TOKEN]` remains recoverable from history.
**Affected parts:** historical `frontend/src/components/locations/MapPicker.tsx:8` (file no longer in tree), `.security-audit/gitleaks.json` (scan output)
**Fix recommendation:** Revoke/rotate the token in the Mapbox dashboard; issue a replacement restricted via a Mapbox access list (and/or client-ID binding). No history rewrite is needed once revoked.
**Notes:** The same leak is documented from the frontend perspective in `03-frontend.md` (FE-01); this entry covers the secrets side. The repo has a GitHub remote (`github.com/silviokennecke/club-event-calendar-2` per the gitleaks link) — if it is public, treat the token as burned regardless; even if private, rotate it.

### SCAN-03 — Live Mapbox token committed as `mapbox-tokens.txt`
**Severity:** MEDIUM
**Attack scope:** Same as SCAN-02 — quota/billing abuse under the `silviokennecke` Mapbox account.
**Description:** `mapbox-tokens.txt` in the repo root is tracked and contains a live Mapbox public token (line 1, `pk.eyJ1Ijoi…[REDACTED-ROTATE-TOKEN]`) from the same account as the SCAN-02 history token (different secret half). Because it is in the current tree — not just history — it is exposed to anyone with read access to the repository.
**Affected parts:** `mapbox-tokens.txt:1` (tracked)
**Fix recommendation:** Rotate/revoke this token (together with the SCAN-02 token — two live tokens from one account). Untrack the file (`git rm --cached mapbox-tokens.txt`) and gitignore it; keep an example file for documentation if needed. Prefer the existing proxy pattern (`MapboxProxyService` + frontend `transformRequest` with the dummy token) so no live token is needed in the repo at all.
**Notes:** The frontend no longer references this file (the proxy pattern superseded it); it appears to be a leftover.

### SCAN-04 — `backend/.env` is tracked in git
**Severity:** LOW
**Attack scope:** Backend runtime config — placeholders only at present, so no direct secret exposure; the risk is that future edits (real `APP_SECRET`, DB credentials, `JWT_REFRESH_SECRET`) get committed.
**Description:** `backend/.env` is tracked. Its current contents are placeholders: `APP_SECRET=changeme` (line 2), root:root DB URLs (lines 3–4), `JWT_REFRESH_SECRET` placeholder (line 5). Because the file is already tracked, the `.gitignore` entries (`.env` line 6, `.env.*` line 7) do not protect it — gitignore only applies to untracked files.
**Affected parts:** `backend/.env:2-5` (tracked), `.gitignore:6-8` (ineffective for tracked files)
**Fix recommendation:** `git rm --cached backend/.env` (keep the local file); the existing `.gitignore` rules then cover it. Placeholders remain in the tracked `backend/.env.example`. Note in AGENTS.md/README that real values belong only in the local, untracked `.env`.
**Notes:** No live secrets found in the tracked file at audit time.

### SCAN-05 — `ip-address@10.2.0` — SSRF + DoS CVEs (via express-rate-limit)
**Severity:** MEDIUM
**Attack scope:** Backend API request path — `express-rate-limit` uses `ip-address` to parse client IPs (including `X-Forwarded-For`); vulnerable parsing is reachable from untrusted request input.
**Description:** Resolved `ip-address` 10.2.0 (root `package-lock.json`; chain: `express-rate-limit` ^10.2.0 → `ip-address`) carries multiple advisories, including `CVE-2026-69192` (SSRF, Trivy HIGH) plus `CVE-2026-101910`, `CVE-2026-101911`, `CVE-2026-101912`, `CVE-2026-101913`, `CVE-2026-54272`, `CVE-2026-69198`.
**Affected parts:** `package-lock.json` (resolved `ip-address` 10.2.0)
**Fix recommendation:** `npm audit fix` / bump the `express-rate-limit` chain to a patched `ip-address`; re-run Trivy to confirm.
**Notes:** MEDIUM per the approved set: the CVE list includes a high-severity SSRF, but exploitation requires the specific input path through the rate limiter.

### SCAN-06 — `js-yaml@4.2.0` — YAML parsing CVEs (toolchain)
**Severity:** MEDIUM
**Attack scope:** Dev/CI toolchain — `js-yaml` is pulled in by `@eslint/eslintrc` (^4.1.1) and `cosmiconfig` (^4.1.0), i.e. lint/config loading in the shared root lockfile, not the shipped app bundle.
**Description:** Resolved `js-yaml` 4.2.0 carries `CVE-2026-59869` (Trivy HIGH), `CVE-2026-84375`, and `GHSA-5p4m-2wfm-xmqj`. Reachable when eslint/cosmiconfig parses attacker-influenced YAML/JSON5 configuration.
**Affected parts:** `package-lock.json` (resolved `js-yaml` 4.2.0)
**Fix recommendation:** Bump the eslint/cosmiconfig chain to a patched `js-yaml`; confirm with `npm audit`.
**Notes:** MEDIUM per the approved set (runtime-reachable via the shared lockfile) with dev-toolchain reach.

### SCAN-07 — `qs@6.15.2` — DoS CVEs (via express / body-parser)
**Severity:** LOW
**Attack scope:** Backend API request path — `qs` parses query strings and form/JSON bodies (express, body-parser); both CVEs are availability issues (crafted input), not data exposure.
**Description:** Resolved `qs` 6.15.2 (chains: `body-parser` ^6.14.1, `express` ^6.14.0) carries `CVE-2026-82417` and `CVE-2026-82562` (DoS).
**Affected parts:** `package-lock.json` (resolved `qs` 6.15.2)
**Fix recommendation:** Bump the express/body-parser chain to a patched `qs`.
**Notes:** LOW — DoS only; fix by update.

### SCAN-08 — `hono@4.12.25` — data disclosure, XSS, low CVEs (via @modelcontextprotocol/sdk)
**Severity:** MEDIUM
**Attack scope:** MCP tooling path — `hono` is a dependency of `@modelcontextprotocol/sdk` (^4.11.4); it is not the main API server (Symfony), so impact is confined to MCP integrations.
**Description:** Resolved `hono` 4.12.25 carries `CVE-2026-71850` (cross-user SSR data disclosure), `CVE-2026-93981` (XSS), and `CVE-2026-71849` (LOW).
**Affected parts:** `package-lock.json` (resolved `hono` 4.12.25)
**Fix recommendation:** Bump the `@modelcontextprotocol/sdk` chain to a patched `hono`; re-verify with Trivy.
**Notes:** Effective risk is lower if MCP is not exercised in production; kept MEDIUM per the approved set.

### SCAN-09 — `react-router@7.18.0` — GHSA-qwww-vcr4-c8h2 RSC-mode CSRF (not applicable)
**Severity:** Informational (N/A)
**Attack scope:** None in this app — the advisory applies to React Server Components (RSC) streaming mode; the frontend is a classic SPA without RSC.
**Description:** Trivy flags `react-router` 7.18.0 for `GHSA-qwww-vcr4-c8h2` (CSRF in RSC mode). Usage was reviewed: no RSC/streaming endpoints exist, so the vulnerable code path is not exercised.
**Affected parts:** `package-lock.json` (resolved `react-router` 7.18.0)
**Fix recommendation:** No action required; revisit if RSC/SSR is ever introduced, and track the advisory through upgrades.
**Notes:** Documented for completeness of the Trivy output.

### SCAN-10 — docker-compose: root MySQL credentials and published DB ports
**Severity:** LOW
**Attack scope:** Local dev/test environment — MySQL root password is `root` and both instances publish their port on all interfaces (`3306:3306` dev, `3360:3306` test), so any process on the host or LAN can reach MySQL with known credentials.
**Description:** `docker-compose.yml`: dev service `MYSQL_ROOT_PASSWORD: root` (line 7) with port `3306:3306` (line 5) and a healthcheck using `-proot` (line 12); test service `MYSQL_ROOT_PASSWORD: root` (line 22) with port `3360:3306` (line 20) and healthcheck (line 25).
**Affected parts:** `docker-compose.yml:5,7,12,20,22,25`
**Fix recommendation:** Bind ports to loopback only (`127.0.0.1:3306:3306`, `127.0.0.1:3360:3306`), set a non-default root password via an env file, and/or create a dedicated app user and drop the root publish.
**Notes:** Dev-only file, no production exposure; LOW.

### SCAN-11 — Plaintext deploy password in local, untracked `.env` + askpass helper
**Severity:** LOW
**Attack scope:** Local machine only — both the root `.env` and `.deploy/` are untracked and gitignored, so there is no repo/history exposure. Risk is local: any process or user on the machine can read the live `DEPLOY_PASSWORD`, and the password is handed to `git` in plaintext via the askpass helper.
**Description:** Root `.env:5` holds a live plaintext `DEPLOY_PASSWORD` (lines 3–6 also carry `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_PATH`), consumed by `.deploy/askpass.sh:2` (`printf '%s\n' "$DEPLOY_PASSWORD"`) and wired up as `GIT_ASKPASS` by a deploy helper script that is not in the repo.
**Affected parts:** `.env:5` (untracked, ignored via `.gitignore:6`), `.deploy/askpass.sh:2` (untracked, ignored via `.gitignore:16`)
**Fix recommendation:** Rotate the deploy password; prefer SSH-key-based deploys over password askpass; at minimum `chmod 600 .env`. (The askpass pattern itself avoids shell history, which is good.)
**Notes:** No repo exposure found; the finding is local credential hygiene.

### SCAN-12 — CI workflow grants `contents: write` to all jobs
**Severity:** LOW
**Attack scope:** Repo supply chain — workflow-level `permissions: contents: write` applies to every job in `ci.yml`, including read-only scan jobs; a compromised job (e.g. via a malicious dependency running at build time) could push commits/tags, enabling self-escalation through the autofix job.
**Description:** `.github/workflows/ci.yml:10-11` sets `permissions: contents: write` at workflow level; the rationale comment (line 9) says it is needed for the autofix job.
**Affected parts:** `.github/workflows/ci.yml:9-11`
**Fix recommendation:** Drop the workflow-level `permissions:` block and add a job-level `permissions: { contents: write }` to the autofix job only; all other jobs stay at the read-only default.
**Notes:** Standard GitHub least-privilege hardening.

## Reviewed & OK
- `composer audit` — no vulnerabilities in the backend PHP dependencies.
- Gitleaks full history (284 commits, `.gitleaks.toml` allowlist) — exactly one finding (SCAN-02); the allowlist itself is narrowly scoped.
- Trivy `fs` (vuln + secret, vendor/node_modules/dist/.git excluded) — all findings covered by SCAN-01…SCAN-09.
- Pattern greps across the repo (AWS `AKIA…`, OpenAI `sk-…`, GitHub `ghp_…`, Slack `xox…`, PEM private-key blocks, `DEPLOY_PASSWORD`/`DEPLOY_KEY`) — no matches beyond the documented Mapbox tokens and the local deploy password.
- `backend/.env.example` and other example env files — placeholders only, no live values.
- JWT key wiring (`lexik_jwt_authentication.yaml`) — env-driven paths, no key material or passphrase hardcoded in the repo (passphrase derives from `APP_SECRET`, line 2 — see SCAN-01 note 3).
- Auth configuration (`security.yaml`, `TokenService`) — stateless JWT + HMAC refresh tokens, no auth cookies; the OAuth state nonce cookie is short-lived by design.
- `.gitignore` — `.env` (line 6), `.env.*` (line 7), `!.env.example` (line 8), `.deploy/` (line 16) all present; the tracked exceptions are covered by SCAN-04.
