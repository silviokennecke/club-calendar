# Dependencies, Secrets & Config Security Audit

## Scope
Secrets and credentials in the working tree and git history, third-party dependency vulnerabilities (JS + PHP), and the security posture of local/CI configuration: `docker-compose.yml`, the GitHub Actions workflow, and `.env*` files. Stack: Symfony 8.1 backend, React SPA frontend, single root `package-lock.json`.

## Method
- Gitleaks full-history scan (284 commits) using the repo's `.gitleaks.toml` allowlist; raw output in `.security-audit/gitleaks.json`
- Trivy `fs` scan via Docker (`--scanners vuln,secret`, skipping `vendor`, `node_modules`, `dist`, `.git`)
- `composer audit` for the PHP backend
- Manual review of `docker-compose.yml`, `.github/workflows/ci.yml`, all `.env*` files, and the JWT key wiring
- Pattern greps across the repo (AWS `AKIA…`, OpenAI `sk-…`, GitHub `ghp_…`, Slack `xox…`, PEM private-key blocks, `DEPLOY_PASSWORD`/`DEPLOY_KEY`)
- CVE findings cross-checked against the resolved versions and dependency chains in the root `package-lock.json`
- Audit made no repo modifications; note `.security-audit/` is not gitignored — do not commit its artifacts

## Date
2026-10-05

### SCAN-04 — `backend/.env` is tracked in git
**Severity:** LOW
**Attack scope:** Backend runtime config — placeholders only at present, so no direct secret exposure; the risk is that future edits (real `APP_SECRET`, DB credentials, `JWT_REFRESH_SECRET`) get committed.
**Description:** `backend/.env` is tracked. Its current contents are placeholders: `APP_SECRET=changeme` (line 2), root:root DB URLs (lines 3–4), `JWT_REFRESH_SECRET` placeholder (line 5). Because the file is already tracked, the `.gitignore` entries (`.env` line 6, `.env.*` line 7) do not protect it — gitignore only applies to untracked files.
**Affected parts:** `backend/.env:2-5` (tracked), `.gitignore:6-8` (ineffective for tracked files)
**Fix recommendation:** `git rm --cached backend/.env` (keep the local file); the existing `.gitignore` rules then cover it. Placeholders remain in the tracked `backend/.env.example`. Note in AGENTS.md/README that real values belong only in the local, untracked `.env`.
**Notes:** No live secrets found in the tracked file at audit time.

### SCAN-07 — `qs@6.15.2` — DoS CVEs (via express / body-parser)
**Severity:** LOW
**Attack scope:** Backend API request path — `qs` parses query strings and form/JSON bodies (express, body-parser); both CVEs are availability issues (crafted input), not data exposure.
**Description:** Resolved `qs` 6.15.2 (chains: `body-parser` ^6.14.1, `express` ^6.14.0) carries `CVE-2026-82417` and `CVE-2026-82562` (DoS).
**Affected parts:** `package-lock.json` (resolved `qs` 6.15.2)
**Fix recommendation:** Bump the express/body-parser chain to a patched `qs`.
**Notes:** LOW — DoS only; fix by update.

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

### SCAN-12 — CI workflow grants `contents: write` to all jobs
**Severity:** LOW
**Attack scope:** Repo supply chain — workflow-level `permissions: contents: write` applies to every job in `ci.yml`, including read-only scan jobs; a compromised job (e.g. via a malicious dependency running at build time) could push commits/tags, enabling self-escalation through the autofix job.
**Description:** `.github/workflows/ci.yml:10-11` sets `permissions: contents: write` at workflow level; the rationale comment (line 9) says it is needed for the autofix job.
**Affected parts:** `.github/workflows/ci.yml:9-11`
**Fix recommendation:** Drop the workflow-level `permissions:` block and add a job-level `permissions: { contents: write }` to the autofix job only; all other jobs stay at the read-only default.
**Notes:** Standard GitHub least-privilege hardening.

## Reviewed & OK
- `composer audit` — no vulnerabilities in the backend PHP dependencies.
- Gitleaks full history (284 commits, `.gitleaks.toml` allowlist) — no genuine secrets in current findings; the allowlist itself is narrowly scoped.
- Trivy `fs` (vuln + secret, vendor/node_modules/dist/.git excluded) — all findings covered by SCAN-04…SCAN-09.
- Pattern greps across the repo (AWS `AKIA…`, OpenAI `sk-…`, GitHub `ghp_…`, Slack `xox…`, PEM private-key blocks, `DEPLOY_PASSWORD`/`DEPLOY_KEY`) — no matches beyond the documented Mapbox tokens.
- `backend/.env.example` and other example env files — placeholders only, no live values.
- JWT key wiring (`lexik_jwt_authentication.yaml`) — env-driven paths, no key material or passphrase hardcoded in the repo (passphrase derives from `APP_SECRET`, line 2; use an independent secret in production).
- Auth configuration (`security.yaml`, `TokenService`) — stateless JWT + HMAC refresh tokens, no auth cookies; the OAuth state nonce cookie is short-lived by design.
- `.gitignore` — `.env` (line 6), `.env.*` (line 7), `!.env.example` (line 8), `.deploy/` (line 16) all present; the tracked exceptions are covered by SCAN-04.
