# Frontend Security Audit

**Date:** 2026-10-05
**Scope:** `frontend/` — React SPA (Vite, react-router, TanStack Query, react-i18next), plus the
frontend-facing parts of `backend/` where the browser is the attacker surface (OAuth redirect,
Mapbox proxy). npm-workspaces monorepo; the lockfile is the root `package-lock.json`.
**Method:** Grep-first for known sink/pattern classes (XSS sinks, `eval`/`new Function`,
`document.write`, dynamic `setTimeout`, storage APIs, `postMessage`/`window.open`/`location.*`,
`target="_blank"`, hardcoded-secret shapes), then targeted reads of the implicated files.
Dependency spot-check via `npm view <pkg> version` (10 security-relevant direct deps) — no
install/audit/build was run. Secret values found in this audit are redacted (`pk.eyJ1Ijoi…`).

---

## Findings

### FE-01 · Hardcoded Mapbox public token committed to git history (leaked)

- **Severity:** High
- **Attack scope:** Anyone with read access to the repository (including a later-forked or
  leaked clone) can recover the token from history and burn the project's Mapbox quota or hit
  plan limits. The token was a valid Mapbox public key (`pk.eyJ1Ijoi…`), not a placeholder.
- **Description:** A real Mapbox public token was committed on **2026-06-12** in commit
  `e0bbc0ab884755f61e8cb3070d1f96469d410244` (author: Silvio Kennecke) at
  `frontend/src/components/locations/MapPicker.tsx:8`. A later commit (`aa6e247…`) deleted
  `MapPicker.tsx`, and the file is gone from the working tree — but the token remains
  recoverable from history (`git show e0bbc0ab8847…`), so removal is not revocation. This is
  the same leak flagged by the gitleaks scan (`.security-audit/gitleaks.json`, rule
  `generic-api-key`, commit `e0bbc0ab…`, date `2026-06-12T10:53:28Z`); the JSON file itself
  still contains the full token and should be treated as sensitive.
- **Affected parts:**
  - `.security-audit/gitleaks.json:8-10` — gitleaks record (RuleID, Commit, Date, matched line 8)
  - `frontend/src/components/locations/MapPicker.tsx` (deleted in working tree; line 8 in
    commit `e0bbc0ab8847…`)
- **Fix recommendation:** **Rotate the token in the Mapbox dashboard** — the working-tree
  cleanup does not expire it. Then either rewrite history (e.g. BFG/lfs-filter) or at minimum
  note in the repo README that the old token is void. Also delete or redact the full token in
  `.security-audit/gitleaks.json` so the secret is not re-committed in a second file.
- **Notes:** The replacement design (see FE-OK-01) proxies Mapbox through the backend, so no
  live token now exists in the frontend tree. The current code path is fine; this finding is
  about the leaked historical secret.

---

### FE-04 · CLI-only `shadcn` package listed as a runtime dependency

- **Severity:** Low
- **Attack scope:** Supply-chain / maintenance surface; no direct browser exploit.
- **Description:** `shadcn` `^4.11.0` is a code-generation CLI, not an importable library; it
  is referenced nowhere in the `frontend/src` code (verified by grep). As a production
  dependency it is unnecessarily installed into the runtime dependency tree of the SPA.
- **Affected parts:** `frontend/package.json:39`
- **Fix recommendation:** Move `shadcn` to `devDependencies` (or drop it; the CLI reads the
  project at invocation time and does not need to be a dep).
- **Notes:** Low exploitability, but it widens the audited dependency surface and is trivially
  wrong placement.

---

### FE-05 · Type-only `@types/mapbox-gl` listed as a runtime dependency

- **Severity:** Low
- **Attack scope:** None directly (types are erased at build time); supply-chain surface.
- **Description:** `@types/mapbox-gl` `^3.4.1` contains only TypeScript declarations and is
  never shipped to the browser. It is in `dependencies`, inflating the production install.
- **Affected parts:** `frontend/package.json:26`
- **Fix recommendation:** Move to `devDependencies` alongside the other `@types/*` entries.
- **Notes:** Same category as FE-04 — placement, not a live vulnerability.

---

### FE-06 · Silent fallback to `http://localhost:3001` when `VITE_API_URL` is unset

- **Severity:** Informational
- **Attack scope:** Misconfigured deployments; developer ergonomics.
- **Description:** `BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001"`
  (`frontend/src/lib/api.ts:4`, mirrored in `mapboxProxy.ts:1`). A build produced without the
  env var compiles fine and then silently points all API traffic at `http://localhost:3001` —
  on a real host that is a dead/misrouted endpoint rather than a loud failure, which can mask
  deployment errors and confuse support.
- **Affected parts:** `frontend/src/lib/api.ts:4`, `frontend/src/lib/mapboxProxy.ts:1`
- **Fix recommendation:** Either fail fast at startup (throw when `VITE_API_URL` is absent in
  a non-dev build) or log a prominent warning. The fallback is harmless for local dev.
- **Notes:** No secret or security value is involved; pure operational hardening.

---

### FE-07 · Several dev/build deps lag the current major (no known vulnerable major)

- **Severity:** Informational
- **Attack scope:** None demonstrated; standard "keep tooling current" hygiene.
- **Description:** `vite` is pinned `^6.4.3` while the registry latest is `8.3.2` (two majors
  behind), and `@simplewebauthn/browser` is `^13.3.0` vs registry `14.0.0`. The 10-dep
  spot-check found all *runtime* deps on current majors with only minor bumps (react 19.2.4
  vs 19.3.0, react-router-dom 7.18.x, @tanstack/react-query 5.101 vs 5.104, i18next 26.3.3 vs
  26.4.2, sonner 2.0.7 vs 2.0.8, lucide-react 1.17 vs 1.52, mapbox-gl 3.24 vs 3.32). No
  vulnerable major is in use.
- **Affected parts:** `frontend/package.json:65` (`vite`), `:24` (`@simplewebauthn/browser`)
- **Fix recommendation:** Bump `vite` toward 8.x and `@simplewebauthn/browser` to 14.x in a
  regular maintenance pass; re-run the build and the WebAuthn flow after the WebAuthn bump.
- **Notes:** `vite` is dev-only (build time), so this is tooling currency, not a runtime risk.

---

## Limitations

- No nginx / web-server configuration exists in this repository, so **CSP, HSTS,
  `X-Frame-Options`, and related response headers could only be reviewed via the Vite config
  and `index.html`** — both of which do not set any security headers or a CSP meta tag. Header
  enforcement is entirely delegated to the (absent) server config and could not be verified.
- Dependency check was a 10-package `npm view` spot-check, not a full `npm audit`; transitive
  dependencies were not inspected.
- No build was run; behavior was inferred from source.

---

## Reviewed & OK

- **FE-OK-01 · Mapbox is fully proxied — no live token in the browser.** `mapboxProxy.ts:3`
  sets a dummy `accessToken` (`"pk.proxy"`), `transformRequest` (lines 5-13) rewrites every
  Mapbox URL to `${BACKEND_URL}/api/mapbox/…` and strips `access_token`; `useMapbox.ts:18`
  uses that client. `mapboxgl.accessToken` is never set to a real key.
- **FE-OK-02 · No XSS sinks.** Grep found no `eval(`, `new Function(`, `document.write`, or
  dynamic `setTimeout`/`setInterval` with strings. The only `innerHTML` in the repo is in a
  test fixture (`src/lib/__tests__/focus.test.ts:7,12,20`), not shipped code.
- **FE-OK-03 · No message/origin handling to exploit.** No `postMessage` and no `window.open`
  anywhere in `frontend/src`.
- **FE-OK-04 · External links are tab-nabbing safe.** The only `target="_blank"`
  (`PublicEventModal.tsx:232`) carries `rel="noopener noreferrer"`.
- **FE-OK-05 · Public feed pages don't leak the feed secret.** They use
  `referrerPolicy: "no-referrer"` plus `<meta name="referrer" content="no-referrer">` and keep
  the secret out of router state.
- **FE-OK-06 · Auth wiring is clean.** `Bearer` tokens are set only in `api.ts:81,100` on
  same-origin requests; `endSession` clears both tokens and hard-navigates to `/login`
  (`api.ts:67-73`). No auth cookies are set by the frontend.
- **FE-OK-07 · Build output can't leak.** Vite outputs to `backend/public`
  (`vite.config.ts:8,21`), which is gitignored (`backend/.gitignore:27 /public/*`) and root
  `dist/` is ignored too; `git ls-files` confirms no build artifact is tracked. The
  `frontend/.gitignore` ignores `.env*` except a committed `.env.local.example`, and no `.env`
  values appear in tracked files.
- **FE-OK-08 · `index.html` is clean.** The only inline script is a theme switcher reading
  `localStorage.theme`; no third-party tags, no external resources, no inline data.
- **FE-OK-09 · Dependencies are current.** 10/10 spot-checked direct deps are on current
  majors (see FE-07); no vulnerable major is present.
- **FE-OK-10 · Lockfile is tracked at the workspace root.** `package-lock.json` covers the
  `frontend` workspace (verified entries for react, react-router-dom, mapbox-gl, shadcn,
  sonner, @simplewebauthn/browser, @types/mapbox-gl), so installs are reproducible.
