# Frontend Security Audit

**Date:** 2026-10-05
**Scope:** `frontend/` — React SPA (Vite, react-router, TanStack Query, react-i18next), plus the
frontend-facing parts of `backend/` where the browser is the attacker surface (OAuth redirect,
Mapbox proxy). npm-workspaces monorepo; the lockfile is the root `package-lock.json`.
**Method:** Grep-first for known sink/pattern classes (XSS sinks, `eval`/`new Function`,
`document.write`, dynamic `setTimeout`, storage APIs, `postMessage`/`window.open`/`location.*`,
`target="_blank"`, hardcoded-secret shapes), then targeted reads of the implicated files.
Dependency spot-check via `npm view <pkg> version` (10 security-relevant direct deps) — no
install/audit/build was run in the original audit; `npm audit` was re-run on 2026-11-05 (see
`04-scans-config.md`). No secret values are reproduced in this document.

---

## Findings

No open findings in this area report. Hardening notes for the frontend: I4 in `AUDIT-2026-10-06.md`.

---

## Limitations

- The frontend itself (Vite config, `index.html`) sets no security headers. They are set by the
  web server configs in this repository, `backend/public/.htaccess` and `docker/Caddyfile`
  (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`, COOP,
  `Referrer-Policy`; identical in both, enforced by `SecurityHeadersConfigTest`). What a
  deployment actually sends was not verified; HSTS is not set by Caddy (`docs/ops/BACKLOG.md`).
- Dependency check was a 10-package `npm view` spot-check, not a full `npm audit`; transitive
  dependencies were not inspected.
- No build was run; behavior was inferred from source.

---

## Reviewed & OK

- **FE-OK-01 · Mapbox is fully proxied — no live token in the browser.** `mapboxProxy.ts`
  (`components/locations/`) sets a dummy `accessToken` (`"pk.proxy"`) and `transformRequest`
  rewrites every Mapbox URL to `${BACKEND_URL}/api/mapbox/…` and strips `access_token`;
  `useMapbox.ts` uses that client. `mapboxgl.accessToken` is never set to a real key.
- **FE-OK-02 · No `eval`-class sinks; the only HTML sink renders backend-sanitised content.**
  No `eval(`, `new Function(`, `document.write`, or dynamic `setTimeout`/`setInterval` with
  strings. `dangerouslySetInnerHTML` appears once in shipped code
  (`components/legal/LegalDocumentView.tsx`), fed with the legal document HTML rendered by the
  backend (`LegalDocumentService`, CommonMark with `html_input: escape` and
  `allow_unsafe_links: false`; the content is operator-provided). Help pages are compiled to
  hast at build time, no raw HTML. The `innerHTML` in `src/lib/__tests__/focus.test.ts` is a
  test fixture.
- **FE-OK-03 · No message/origin handling to exploit.** No `postMessage`. `window.open` is used
  only in `FeedPage.tsx` for the "add to Google/Outlook calendar" links, with `"noopener"`.
- **FE-OK-04 · External links are tab-nabbing safe.** Every `target="_blank"` anchor carries
  `rel="noopener noreferrer"` or `rel="noreferrer"` (`PublicEventModal.tsx`,
  `ConsentHistoryList.tsx`, `CopyField.tsx`).
- **FE-OK-05 · Public feed pages don't leak the feed secret.** They use
  `referrerPolicy: "no-referrer"` plus `<meta name="referrer" content="no-referrer">` and keep
  the secret out of router state.
- **FE-OK-06 · Auth wiring is clean.** `Bearer` tokens are set only in `api.ts` on
  same-origin requests; `endSession` clears both tokens and hard-navigates to `/login`. No auth cookies are set by the frontend.
- **FE-OK-07 · Build output can't leak.** Vite outputs to `backend/public`
  (`vite.config.ts`, `outDir`), which is gitignored (`backend/.gitignore`: `/public/*`) and root
  `dist/` is ignored too; `git ls-files` confirms no build artifact is tracked. The
  `frontend/.gitignore` ignores `.env*` except a committed `.env.local.example`, and no `.env`
  values appear in tracked files.
- **FE-OK-08 · `index.html` is clean.** No inline script (the theme switcher is the external
  `public/theme-init.js`, needed for the CSP `script-src 'self'`); no third-party tags, no
  external resources, no inline data.
- **FE-OK-09 · No production dependency advisories.** `npm audit --omit=dev` reports 0
  vulnerabilities (2026-11-05); dev-only advisories are in `04-scans-config.md`.
- **FE-OK-10 · Lockfile is tracked at the workspace root.** `package-lock.json` covers the
  `frontend` workspace (verified entries for react, react-router-dom, mapbox-gl, shadcn,
  sonner, @simplewebauthn/browser, @types/mapbox-gl), so installs are reproducible.
