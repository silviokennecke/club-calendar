# Dependencies, Secrets & Config Security Audit

## Scope
Secrets and credentials in the working tree and git history, third-party dependency vulnerabilities (JS + PHP), and the security posture of local/CI configuration: `docker-compose.yml`, the GitHub Actions workflow, and `.env*` files. Stack: Symfony 8.1 backend, React SPA frontend, single root `package-lock.json`. The shipped app has no Node server: Node packages are build and test tooling only.

## Method
- Gitleaks full-history scan using the repo's `.gitleaks.toml` allowlist
- Trivy `fs` scan via Docker (`--scanners vuln,secret`, skipping `vendor`, `node_modules`, `dist`, `.git`)
- `composer audit` for the PHP backend
- Manual review of `docker-compose.yml`, `.github/workflows/ci.yml`, all `.env*` files, and the JWT key wiring
- Pattern greps across the repo (AWS `AKIA…`, OpenAI `sk-…`, GitHub `ghp_…`, Slack `xox…`, PEM private-key blocks, `DEPLOY_PASSWORD`/`DEPLOY_KEY`)
- CVE findings cross-checked against the resolved versions and dependency chains in the root `package-lock.json`
- Audit made no repo modifications

## Date
2026-10-05; scanner results re-run on 2026-11-05 (branch `security/audit-followup`).

### SCAN-12 (residual) — release workflow keeps `contents: write` for the reusable CI call
**Severity:** Informational
**Attack scope:** Repo supply chain on tag builds only. The workflow-level default is now `contents: read` (`ci.yml`, `release.yml`); `contents: write` is declared only for `autofix` in `ci.yml` (skipped on tags), `release` in `release.yml`, and `packages: write` for the image job.
**Description:** `release.yml` job `ci` (`uses: ./.github/workflows/ci.yml`) must grant `contents: write` because the called workflow's `autofix` job declares it, although `autofix` does not run on tags (`if: github.ref_type == 'branch'`). All CI jobs therefore have a write-capable token available during a release run.
**Affected parts:** `.github/workflows/release.yml` (job `ci`, `permissions`), `.github/workflows/ci.yml` (job `autofix`)
**Fix recommendation:** Move the autofix job out of the reusable workflow, or call it only for branch pushes.
**Notes:** The main part of SCAN-12 (workflow-wide `contents: write`) was fixed in `c1bcc7a`.

## Scanner results (2026-11-05)

- **`npm audit`** (root lockfile): 53 advisories (1 low, 45 moderate, 7 high, 0 critical). **`npm audit --omit=dev`: 0**, so none of them is in a dependency of the shipped app. High: `shadcn` (direct devDependency of `frontend`), `@shadcn/registry`, `zod`, `body-parser`, `follow-redirects`, `joi`, `undici`. The earlier critical `vitest`/`tinypool`/`proxy-addr` entries no longer appear (vitest 5.1.0, proxy-addr 2.0.8). `qs` is 6.16.1 and reached only through the dev-only chain `shadcn` -> `@modelcontextprotocol/sdk` -> `express` -> `body-parser`; the former SCAN-07 advisories do not apply to it and the chain is not on any backend request path. `react-router` is 7.18.4 and not reported (the former SCAN-09 advisory concerned RSC mode, which the app does not use).
- **`composer audit` (backend): 18 advisories in 11 `symfony/*` packages at 8.1.9** (config, filesystem, framework-bundle, http-client, http-foundation, http-kernel, routing, security-http, serializer, validator, yaml), all reported 2026-11-04 and fixed in 8.1.11; not yet triaged for exploitability in this app.
- **gitleaks** (665 commits, `.gitleaks.toml`): 1 finding, a Mapbox public-token-shaped value in history (commit `e0bbc0a`, a file since deleted); none in the working tree.
- Trivy and semgrep were not re-run (not installed). Their earlier results are in `AUDIT-2026-10-06.md`.

## Reviewed & OK
- The gitleaks allowlist (`.gitleaks.toml`) is limited to placeholder and CI-only fake values.
- Pattern greps across the repo (AWS `AKIA…`, OpenAI `sk-…`, GitHub `ghp_…`, Slack `xox…`, PEM private-key blocks, `DEPLOY_PASSWORD`/`DEPLOY_KEY`) — no matches beyond the documented Mapbox tokens.
- `backend/.env.example` and other example env files — placeholders only, no live values.
- JWT key wiring (`lexik_jwt_authentication.yaml`) — env-driven paths, no key material or passphrase hardcoded in the repo.
- Auth configuration (`security.yaml`, `TokenService`) — stateless JWT + HMAC refresh tokens, no auth cookies; the OAuth state nonce cookie is short-lived by design.
- `.gitignore` — `.env` (line 6), `.env.*` (line 7), `!.env.example` (line 8), `.deploy/` (line 16) all present.
