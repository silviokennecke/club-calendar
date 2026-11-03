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

No open findings.

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
