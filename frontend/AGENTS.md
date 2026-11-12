# Frontend Stack

This is a **Vite + React + React Router** SPA (not Next.js).

Contents: [Key conventions](#key-conventions) · [Design system and areas](#design-system-and-areas) (tokens, theme,
shell, calendar, routed modals, events, import, templates, settings, publish / club / profile, public access,
unsaved changes, i18n, API errors, history focus, contrast) · [Accessibility and structure
rules](#accessibility-and-structure-rules) · [E2E](#e2e-playwright-frontende2e) ·
[Shared UI components](#shared-ui-components) · [Build](#build)

## Key conventions

- **Terminology:** UI terms for target groups, features and properties (Audience, Extra, Badge) are defined in CLAUDE.md "Terminology"; UI texts must use them.
- **CSP:** the app is served with `script-src 'self'` and `style-src 'self'` plus the hash of emoji-mart's shadow-DOM stylesheet (no `'unsafe-inline'`): no inline `<script>`, no `<style>` element, no `style="…"` in HTML strings or `setAttribute('style', …)` (React `style={{}}` and `el.style.x = …` are CSSOM and fine); a library that injects a `<style>` needs its CSS shipped as a file (see `vite/sonner-css.ts`); no `eval`/`new Function`, no third-party script/connect hosts (new hosts go into the CSP in `backend/public/.htaccess` AND `docker/Caddyfile`, see CLAUDE.md "Deployment"). Early boot code belongs in `public/*.js`.

- Routing: React Router v7 (`react-router-dom`), data router (`createBrowserRouter` with one splat route; needed
  for `useBlocker`); the routes stay declarative `<Route>`s in `AppRoutes`
- All routes defined in `src/App.tsx`, rendered through `components/layout/BackgroundRoutes` (routed modals, below)
- Page components live in `src/pages/`, `src/pages/settings/` and `src/pages/events/`
- Protected routes wrapped in `src/components/layout/ProtectedRoute.tsx`
- No SSR, no server components, no API routes
- Environment variable: `VITE_API_URL` (not `NEXT_PUBLIC_API_URL`)
- Navigation: `useNavigate()` / `useParams()` / `useLocation()` from `react-router-dom`
- Links: `<Link to="...">` (not `href`)
- Lazy loading: `React.lazy()` + `<Suspense>` (not `next/dynamic`). Every page and routed modal is lazy
  (`src/pages/lazy.ts`, imported by `App.tsx`); new pages are added there. Suspense boundaries: one in
  `BackgroundRoutes` around pages + modals (first load; later page navigations run in the router's transition, so
  the current page stays until the next chunk is loaded), one around the `Outlet` of `AppShell` (first load keeps
  sidebar / tab bar) and one inside `ModalFrame` (the dialog content renders in a portal outside the transition: a
  dialog chunk that is still loading shows a loading state in the open dialog, focus then moves to the step's
  start). Pages that open the event dialogs call
  `useEffect(preloadEventModals, [])` (calendar, event list, templates; `FeedPage`: `preloadPublicEventModal`).
  Large libraries stay in their own lazy chunks (mapbox-gl via the map components, emoji-mart via `EmojiMartPanel`);
  vendor chunks (`vendor-react`, `vendor-query`, `vendor-i18n`) are set in `vite.config.ts` `manualChunks`.
  Pages are wrapped by `lazyPage` (`lazy.ts`), see "Error page and reload guard" below.
- Error page and reload guard: `components/error/ErrorPage.tsx` (eager, in the entry chunk) is the router's
  `errorElement` (`App.tsx`), the catch-all `<Route path="*">` of `AppRoutes` (404) and, as `AppErrorBoundary`, the
  outermost boundary in `main.tsx` (errors in the theme provider or router). `lib/loadError.ts` sorts an error into
  `notFound` (status 404), `load` (failed dynamic import / chunk, typically after a deploy: hint to reload) and
  `generic`. `ErrorScreen` needs only i18n (no router, auth or query context): `AuthLayout` card with icon, h1
  (focused on display, `document.title`), skip link, actions "Seite neu laden" (`location.reload`), "Zur Startseite"
  (plain `<a href="/">`, a fresh document) and "Zurück" (404 only). Texts: `errorPage.*` (de + en). If the texts are
  not available, `ErrorScreen` falls back to a hard-coded German emergency text (the only hard-coded UI strings;
  commented). Technical details (stack) appear in a `<details>` in development only, never in production.
  `vite:preloadError` (`main.tsx` -> `lib/chunkReload.ts` `handlePreloadError`) reloads once per browser session and
  failed file (sessionStorage `chunkReloads`: map of failed file URL -> time; no usable sessionStorage means no
  reload); if the same file still fails afterwards the error surfaces and the error page shows instead of a loop.
  After `preventDefault()` Vite's preload helper resolves the import with `undefined` (React.lazy would log
  "Cannot read properties of undefined (reading 'default')"): `lazyPage` keeps such an import pending
  (`untilReload`) while the page reloads. E2E: `e2e/error-page.spec.ts` (404, blocked page module on the dev server;
  the production flow runs with `E2E_PREVIEW_URL`, see `docs/ops/E2E.md`).
- i18n: German is bundled, English (`locales/en.json`) is a lazy chunk loaded by an inline i18next backend
  (`src/lib/i18n.ts`); `main.tsx` renders after `i18nReady`. A failed chunk import after a deploy reloads the page
  once (`vite:preloadError` in `main.tsx`, guard and error page: see "Error page and reload guard").
- **Operator docs:** a change to the build output, CSP or other security headers, or a user-facing setting operators control (sign-in, SSO, languages) also updates `../docs/admin/` (CLAUDE.md working rule 10), in plain English for operators (headers and CSP go to the protection page `docs/admin/docs/security.md`, settings to `docs/admin/docs/configuration/reference.md`).

## Design system and areas

Background: `docs/ops/BACKLOG.md` (open backend gaps and operations), `docs/api/openapi.yaml` (API reference).

- Confirmation dialogs follow the wording of the design's `Dialogs.dc.html` (see the table there).

- Tokens + component classes live in `src/index.css` (design `cc-tokens.css`, `.cc-*`, `.ap-*`, `.t-*`).
  Tailwind utilities map to tokens: `bg-surface`, `bg-surface-raised`, `bg-surface-sunken`, `text-ink`,
  `text-ink-muted`, `border-border`, `border-border-strong`, `bg-brand`, `text-on-brand`, `bg-brand-soft`,
  `bg-danger`, `bg-danger-soft`, `text-info`, `bg-highlight` (= design `--accent`, orange),
  `bg-tag-youth|adult|senior`, `min-h-tap`/`size-tap` (44px). Tailwind `accent` stays the shadcn hover surface.
- Motion tokens on `:root` in `index.css`: durations `--dur-fast` (100ms), `--dur-base` (160ms), `--dur-slow` (240ms);
  easings `--ease-out` (enter, default), `--ease-in` (exit), `--ease-in-out`, `--ease-spring` (critically damped,
  no overshoot). Use them for every new `transition`/`animation` instead of literal times; the `.ap-skel` pulse (overlay opacity) is compositor-only; the `.ap-tabs` underline and the `.ap-seg` pill slide (`lib/tabIndicator.ts` sets `--ind-x`/`--ind-w` (+ `--ind-y`/`--ind-h` for the pill) on the bar, CSS `[data-slide]::after` in `index.css`; reduced motion disables it).
- Pressed state: one shared `:active` block at the end of `index.css` (`scale` 0.97, 0.985 for rows/cards/day cells; reduced motion keeps only an opacity change). New interactive classes go into that block.
- shadcn variables (`--primary`, `--background`, ...) point at the design tokens.
- Font: Figtree via `@fontsource-variable/figtree` (self-hosted, imported in `main.tsx`).
- Theme: `ThemeProvider` (`src/lib/ThemeProvider.tsx`) + `useTheme()` (`src/lib/theme.ts`), `light|dark|system`,
  localStorage key `theme`, sets `data-theme` on `<html>`; inline script in `index.html` prevents a flash.
  `dark:` variant follows `[data-theme="dark"]`.
- Mobile breakpoint: 720px. App frame: `src/components/layout/AppShell.tsx` (Sidebar, Topbar, Tabbar,
  SettingsTabs, skip link); navigation mapping in `layout/navigation.ts`. Child routes get `ShellData`
  via `useOutletContext()`.
- Auth/setup frame: `components/auth/AuthLayout.tsx` (card, `top` for the Stepper, `headerEnd`, `bare` for the
  club picker, `headingRef` for focus). `/setup` is the onboarding (Stepper Verein/Kalender; always starts at step 1 (new
  club), `?clubId=` continues at step 2 for that club; "Vorerst überspringen" on step 1 leads to `/clubs?select=1`); `/clubs` is the club
  picker (`?select=1` skips the last-calendar redirect and the redirect to /setup; without a club it forwards to /setup unless invitations
  are waiting, which `components/clubs/InvitationsSection` lists with accept / decline);
  Invitation mail link: `/invitations?token=…` (`pages/InvitationPage`, outside `ProtectedRoute`, neutral accept / decline via
  `POST /api/invitations/accept|decline`). The token moves into `sessionStorage` (`lib/invitations`: `stashInvitationToken`) and
  out of the URL at once; a signed-out visitor goes to /login (the entry flow below previews the token and prefills the address), after the sign-in `/clubs` forwards back to `/invitations`; the
  token is cleared after use or when dead. Accepting switches to the club (`lib/useEnterClub`).
  Sign-in entry (`pages/SignInPage`, routes `/login` and `/signup` render the same page): one email-first flow. Step 1 =
  e-mail field + "Weiter" + SSO / passkey buttons; submit validates the address, then `POST /api/auth/identify`
  decides step 2: `login` (`components/auth/LoginStep`: password, forgot link, `email_not_verified` -> `/verify-email`,
  429 with `ApiError.retryAfter`; a `mfaRequired` login answer renders `components/auth/MfaStep` in place: authenticator code, backup code or passkey, `invalid_mfa_token` returns to the password with a banner), `register` (`components/auth/SignupStep`: the signup fields and consent checkboxes,
  then `/verify-email`) or `registration_restricted` (banner "only with an invitation", no form). Step 2 shows the
  address read-only, SSO / passkey are gone, "Zurück" and Escape return to step 1 with the address kept (focus: first
  field of the new step, the email field on return; passkey autofill: while step 1 is shown and `PublicKeyCredential.isConditionalMediationAvailable()` is true, `startAuthentication({useBrowserAutofill: true})` runs on mount (the email input has `autocomplete="username webauthn"`), is cancelled via `WebAuthnAbortService.cancelCeremony()` on submit, unmount and step change, AbortError/NotAllowedError are silent, success shares the passkey button flow; an sr-only `role=status` announces each step). Transitions: `components/auth/Collapse`
  (grid-template-rows 0fr -> 1fr + fade, `.ap-collapse` in `index.css`, inert while closed, unmounted after the exit,
  no motion under `prefers-reduced-motion`). The stashed invitation token (`lib/invitations`) is previewed with
  `POST /api/invitations/preview`: banner "invited to <club>" + prefilled address (typing replaces it); 404 = neutral
  "invalid or expired" banner and the token is dropped. The token stays stashed through registration and the code page.
  `GuestRoute` sends signed-in users from /login, /signup, /verify-email, /forgot-password, /reset-password to /clubs.
  `AuthProvider` clears the tokens only when `/me` answers 401/403; network errors, 429 and 5xx keep them, retry twice
  and then set `sessionError` (retried on `online` / tab visible), during which `GuestRoute` shows the loader, not the form.
- Token storage (`lib/api.ts`, `lib/AuthProvider.tsx`): the refresh token lives in `localStorage` (`refresh_token`), so the session survives new tabs and browser restarts; the access token is memory-only per tab and obtained by a refresh on page load. Refreshes are serialised across tabs with `navigator.locks` (`cc-refresh`; without Web Locks a per-tab single-flight). Tabs sync over `BroadcastChannel` `cc-auth` (access token only, never the refresh token) and the `storage` event (refresh-token changes, logout: a logout in one tab signs out all tabs). `sessionStorage` is only for tab-bound state (SSO PKCE verifier, invitation token, feed proof). The trade-off (XSS can read the refresh token) is in `docs/ops/BACKLOG.md`.
- MCP consent (`/oauth/consent?request=<id>`, `pages/OAuthConsentPage`, inside `ProtectedRoute` as a standalone page like
  `/clubs`): an AI client sent the browser here from `GET /api/oauth/authorize`. Shows the server-derived `label` (never the self-declared `claimedName`, which appears only as "calls itself ..." when it differs), redirect host,
  a warning for `callbackRisk` (loopback / ChatGPT connector), an "unverified app" banner when `family` is null and the scopes as words; Allow / Deny post
  `POST /api/oauth/authorize/decision` and the browser follows `redirectUrl` (`navigateAway`, replaceable in tests).
  Unknown / expired / answered requests and requests started in another browser (404 `authorization_request_not_found`: the backend binds the request to the browser by the cookie `oauth_consent_<id>`, which `apiFetch` sends with `credentials: include` for `/api/oauth/*`; expired `expiresAt`) show the expired
  state; codes map in `decisionFailure` (`lib/mcp`). A signed-out visitor: `ProtectedRoute` stashes the consent URL
  (`stashReturnTo`, sessionStorage, 10 min, only this path shape) and `/clubs` forwards back to it after any sign-in
  (`takeReturnTo`). Profile: `components/profile/ConnectedAppsSection` ("Verbundene Apps": `GET /api/auth/mcp-grants`,
  revoke by `ConfirmDialog` + `DELETE /api/auth/mcp-grants/:id`). E2E: `e2e/mcp-consent.spec.ts`.
- Password reset: `/forgot-password` (`ForgotPasswordPage`: form → "Prüfe dein Postfach" with the entered address;
  the API answers 204 for every address, 429 counts as sent, only network / server errors show a banner) and
  `/reset-password?token=` (`ResetPasswordPage`: reads the token once and removes it from the address with a
  `replace` navigation, `useMetaTag("referrer", "no-referrer")`; states form / invalid (unknown, used and expired look
  the same, "Neuen Link anfordern") / done (banner + "Weiter zur Anmeldung")). API helpers `lib/passwordReset.ts`;
  the password policy (8–128 characters, counted as code points like the API) is `lib/password.ts`, also used by the
  signup and the profile. E-mail confirmation by a 6-digit code: `/verify-email?email=` (`VerifyCodePage`, guest
  route; `CodeInput`; auto-submit → `POST /api/auth/verify-email` → `exchangeOneTimeToken` (`one_time_token` grant in
  `lib/api.ts`) → `login()` → `/clubs`; wrong code = field error `invalid_verification_code`, `invalid_grant` → login;
  "Send again" shows the `retryAt` time of `verification_resend_too_early`, `ApiError.retryAt` / `.email` carry the
  extra problem members). Signup, login (403 `email_not_verified`) and the SSO callback
  (`?error=email_verification_required&email=`) lead there. `/auth/verify-email` only shows the result of an e-mail
  change (`status=email_changed`, `flow=email_change` errors with "Zum Profil"); anything else goes to `/verify-email`.
- Context switcher menus (`layout/ContextMenu.tsx`): disclosure with Escape, arrow keys, Home/End, Tab-out closes.
- Calendar (no FullCalendar): pure date logic in `src/lib/calendar/` (`dates.ts` ISO-date arithmetic in UTC,
  month grid, ISO weeks, `todayIn(timeZone)`; `items.ts` events/holidays as inclusive ranges, week lane layout,
  `shiftEventDates`; `format.ts` Intl labels in the current language; `view.ts` URL view/anchor, ranges, grid keys),
  all with Vitest tests. Events and holidays are loaded for exactly the visible range (the API filters by overlap, no
  look-back); "Noch keine Termine in diesem Kalender" uses the calendar's `eventCount`. UI in `components/calendar/`: `MonthView` (desktop `MonthBoard` with event bars +
  `DayPanel`, phones `MonthGrid` + day list), `WeekView`, `EventChip`, `EventItem`, `CalendarToolbar`/`MonthNav`,
  `FilterBar`, `CalendarSearch` (the one search of every calendar view: autocomplete popup with at most `SEARCH_LIMIT` = 10 previews, last option "Alle Ergebnisse anzeigen" always present; the caller supplies `search`, `onPick`, `onShowAll`: staff = server `?q=&limit=10`, pick opens the edit dialog, show-all goes to `…/events?q=`; `PublicCalendarView` = client-side name search over all events of the source (feed `events` / `my-events` without range, shared cache entry), pick opens the read-only event dialog, show-all sets `view=list&q=`, and a list with `q` spans all dates, `isSearchList`), `CalendarLegend`, `CalendarSkeleton`, `useCalendarData`, `useGridKeyboard` (roving tabindex).
  The calendar page keeps view and date in the URL (`?view=week&date=2026-10-08`). The shown view and date are also remembered per calendar in sessionStorage (`calendarView:<id>`, `view.ts` neighbour `viewMemory.ts`); opening the page without `view` and `date` restores them (replace navigation), explicit URL parameters win. `useIsMobile()` /
  `useMediaQuery()` in `src/lib/useMediaQuery.ts`.
- Routed modals (background-location pattern): the event dialogs and the public event detail have their own,
  deep-linkable URLs but render as a dialog above a background page. `src/lib/modalRoutes.ts` (pure, tested):
  `matchModal(path)` knows the modal paths, `modalBackground(location)` = router state `background` (path + query
  of the opening page; public pages store it without `?secret=`, `publicBackPath` adds the secret from the address
  again) or, for deep links, the calendar (`?date=` of the dialog) / the public feed. `BackgroundRoutes` renders the
  pages at the background location inside a `display: contents` wrapper with `inert` (the page stays mounted and
  visible, its state survives), the modal routes on top, and returns focus (`lib/modalFocus.ts`:
  `focusAfterModalClose(eventSelector(id))` focuses the saved event via `data-event-id`, else the opener, else the
  page heading (`h1`, e.g. the month title: deep links have no opener and a new series may start outside the visible
  month), else `#main`). Openers pass `state={openModalState(location)}` (calendar: create, split button, day panel
  "Termin am … anlegen" (opens the new-event form; a double click on a day does the same), FAB, chips / items; list: rows, create, FAB, empty states; templates: "Termin aus
  Vorlage"). Inside a modal `useModalNav()` (`lib/useModalNav.ts`): `step(to)` / `stepLink(to)` replace the
  history entry (one entry per dialog, so the browser's back button closes it), `close()` = history back (or
  replace to the background for deep links / `direct`), `setBackground(path)` lets a deep link show the event's
  month below. The modal routes share one `ModalFrame` layout route, so focus trap, scroll lock and focus return
  stay while the steps swap.
- Legal documents: `lib/legal/index.ts` (`useLegalOverview` = `GET /api/legal`, `useLegalDocument(type)`, `useLegalVersion(id)`),
  `components/legal/LegalDocumentView` (backend HTML in `.legal-prose`, loading / 404 "not provided" states) and
  `ConsentCheckboxes` (signup, consent page), `ConsentHistoryList` (profile and the consent page's history modal; the gate also offers `DeleteAccountDialog`) and `LegalLinks` (footer of `AuthLayout` and `PublicShell`; hides types without a published document, returns null when none are available). `/imprint`,
  `/privacy`, `/terms` are a routed modal (`pages/LegalModal`) only with a stored `background` (`openModalState`),
  else the standalone `pages/LegalPage`. Texts: `legal.*`. `ConsentChangeBanner` (rendered by `ProtectedRoute`: top of `AppShell`'s `<main>` or above the standalone `/clubs` and `/setup`) is a dismissible banner (sessionStorage, keyed by the pending document ids) for `pendingConsents` without `consentRequired`; its dialog opens documents inline via `ConsentCheckboxes` `onOpenDocument` (no routed modal on a dialog). External links: a type with a `url` (`LegalSummary`/`LegalDocument`/`PendingConsent`/`ConsentRecord.documentUrl`) never opens a modal: `LegalLinks` renders a plain same-tab `<a>`, `/imprint` etc. redirect via `useExternalRedirect` (`window.location.replace`, loader meanwhile), and in state-bearing contexts (`ConsentCheckboxes` via `ConsentItem.url`, consent history) it opens in a new tab (`externalLinkProps`). The test setup mocks `LegalLinks` (needs router + query client).
- Events (create / edit are routed dialogs; URL helpers in `components/events/routes.ts`):
  `…/events` list page (`?status=draft&q=`); dialogs (`pages/events/*Modal.tsx`): `…/events/new/form` form (`?date=`, `?templateId=` pre-fills from a template,
  EventNewForm), `…/events/new/template` picker (EventNewTemplate), `…/events/new/template/:templateId` single event
  (`POST …/events/from-template`) or series (EventSeries: the dates of the rule come from the backend,
  `components/events/useSeriesPreview.ts` = `POST …/events/series/preview` debounced with loading / error / limit
  (366, 422 `too_many_events`) / empty states; no query retries, an error shows at once and "Erneut versuchen" refetches; "n Termine … anlegen" = one atomic `POST …/events/series` with
  `{rule, templateId, isDraft}`; the browser never computes series dates), `…/events/:eventId` edit (EventForm, read-only in
  archived calendars; events of a series show "Teil einer Terminreihe (n Termine)" with the rule text from the
  single GET's `series`, and saving changes / deleting asks "Nur diesen Termin" / "Alle Termine der Reihe" via
  `ConfirmDialog` `alternative`: "all" PATCHes only the changed fields (`changedEventFields`) with `scope: "all"`
  (the backend keeps each event's date), deleting all is `DELETE …?scope=all`; the series notice links "Reihe ändern"),
  `…/events/:eventId/series` "Reihe ändern" (`EventSeriesEditModal`, own addition: rule form `SeriesRuleFields` shared
  with "Termin aus Vorlage", `useSeriesUpdatePreview` = `POST …/event-series/{id}/preview-update` debounced; lists
  new / deleted / unchanged / past events in a live region, `ConfirmDialog` "Löscht n künftige Termine, legt m neue
  an. Vergangene Termine bleiben.", then `PATCH …/event-series/{id}`; 409 / 422 / 403 / network as banners); `…/events/export` stays a page with a format choice ICS | PDF (downloads `GET …/events.ics` or `…/events.pdf` with the JWT via `apiFetch` + `errorFrom` + Blob + `a[download]`;
  the count preview uses `selectForExport`/`exportQuery` with the same rule). PDF-only options: layout radios (month grid, annual, quarter, agenda; unavailable ones are disabled by
  `availableLayouts`: quarter needs 3 touched months, annual exactly 1 Jan to 31 Dec, an unavailable chosen layout falls back to month grid), paper A4/A3, orientation; "Whole calendar" is ICS-only (switching to PDF falls back to "This month"),
  both formats offer the ranges (in order) whole calendar (ICS only), this month, "This year", "Next year" (`nextYear`, 1 Jan to 31 Dec of today's year + 1, both enable the annual layout) and custom; the button is disabled with a banner above 2000 events or 366 days (backend stays authoritative). Failures are mapped by `code` in `pdfFailure` (`too_many_events`, `validation_failed` on `to`, `rate_limited` with `Retry-After`, else generic). The list's bulk actions
  (publish / draft / delete) are one atomic `POST …/events/bulk` (fails as a whole, selection stays). Create dialogs of archived calendars show
  the archive notice instead of the form (`CreateGateBody`, `createGateState.ts`). Save / delete invalidate
  `["events", calendarId]`, toast, `unsaved.allow()`, close; save failures are also shown in the dialog (toasts sit
  behind the modal for screen readers). Pure logic in `src/lib/events/` (`form.ts` values/validation/payload,
  `list.ts` tabs/search/groups, `series.ts` series types, preview rows, rule text (`describeSeriesRule`) and the
  changed-fields diff for "all", `ics.ts` export query/selection/`exportFileName` + the one-event ICS writer `buildEventIcs` of the public event, `pdf.ts` PDF query, layout availability, caps, error mapping, `format.ts`), with Vitest tests.
  Note (`note`, plain text, max `NOTE_MAX` = 2000, newlines kept, "" = none): `TextArea` in the event and template
  forms (with a character counter in the hint), prefilled from the template (`valuesFromTemplate`, shown in the
  "Termin aus Vorlage" step), shown read-only in `PublicEventModal` (`white-space: pre-line`, rendered as text, URLs
  stay plain text), written first in the DESCRIPTION of `buildEventIcs`, filled from DESCRIPTION by the ICS import.
  In the create form (not when editing or read-only) the name field is an `AutocompleteInput` over the calendar's templates
  (same query key `["templates", calendarId]` as the dialog, no error UI: without data it is a plain input); applying a suggestion
  (`applyTemplateToValues`, `lib/events/form.ts`) overwrites name, both times (only if the template has both), location, properties, features,
  target groups and note wherever the template has a value and sets `eventTemplateId`; dates and status are never touched.
  Events of a series (`seriesId` in every event list) carry the tag "Wiederkehrend" (`Tag tone="brand"`) in
  `EventsTable` and `EventItem` (`CalItem.recurring`), not on the month chips; bulk actions treat them like any event.
  UI in `components/events/` (`EventsTable`, `LocationSection` (location autocomplete, last suggestion "Neuen Ort anlegen" opens `LocationCreateDialog`, a stacked `FormDialog` using `components/locations/LocationFields`; position only via that dialog or the places page; static `LocationImage` map, no mapbox-gl in the event form), `StatusSeg`,
  `CreateGate`, `useEventResources`, `useEventPage`, `ArchivedCreateGuard` for the import / template / feed pages).
- Import: `…/import` is one page with a Stepper (Datei, Prüfen, Fertig; state in `pages/ImportPage.tsx`,
  UI in `components/import/`: `ImportUpload` file input + drop zone, `ImportReview` bulk panel / groups / summary bar,
  `ReviewGroup`, `ImportEditDialog`, `ImportDone`). Pure logic in `src/lib/import/` (`ics.ts` parser incl. unfolding,
  TZID/UTC, all-day end, skipped events, recurrences: `rrule.ts` expands RRULE (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL,
  COUNT, UNTIL, BYDAY incl. `2MO`/`-1FR`, BYMONTHDAY, BYMONTH, WKST) with EXDATE / RDATE / RECURRENCE-ID into SINGLE
  events (`externalUid` = `UID#YYYYMMDD`, max. 366 per rule, rules without end two years, max. `IMPORT_MAX` per file;
  unsupported parts like BYSETPOS keep the first event with a warning; stats in `IcsParseResult.recurrence`); `review.ts` items, groups by name, place matching, bulk id diffs, duplicates,
  request body `toImportRequest` with `locationTempId` for new places and `externalUid` from the ICS UID,
  `checkFromPreview`) with Vitest tests. The file is parsed in the browser; `components/import/useImportPreview.ts`
  sends all items to `POST …/events/import/preview` (debounced, reruns after edits, not after selection changes):
  duplicates (UID or name + day), entries the backend would reject ("Fehlerhaft", block the import while selected)
  and `warnings` (replaced time zones). If the preview fails, the duplicate hint falls back to name + day in the
  browser. The import is ONE atomic `POST …/events/import` with `locations: [{tempId, name}]` (no chunks, no partial
  result; at most `IMPORT_MAX` = 5000 selected, above that a banner blocks it, a 413 `too_many_events` shows its own
  failure text); the result shows imported, skipped, created places (`createdLocations`) and warnings.
- Templates: own routed pages `…/templates` (`TemplatesPage`: cards, `?q=` search, delete dialog with the
  template's `eventCount`), `…/templates/new` and `…/templates/:templateId` (`TemplateEditPage`, read-only in archived
  calendars); pure logic in `src/lib/templates/` (`form.ts`: values, validation, payload, `templateTimes`,
  `templateDeleteConsequence`). Times are optional (new templates start empty, only both or none); a template
  without times creates all-day events and shows "Ganztägig" on cards, in the picker and in "Termin aus Vorlage". `components/events/AssignmentFields` (properties / features / target groups with
  inline creation) is shared by the event form, the template form and the import review.
- Settings: all pages below `…/settings` use `components/settings/SettingsLayout` (heading with club and
  calendar, `SettingsTabs`, the read-only banner of archived calendars with "Archivierung aufheben", skeleton /
  error states; `wide` for the places page). `useSettingsPage()` = `useEventPage()` + club + `readOnly`.
  Locations, target groups and feeds are CLUB data: their pages live at `/clubs/:clubId/settings/{locations,
target-groups,feeds,feeds/new,feeds/:feedId}` (no calendar in the URL; the old `…/calendars/:calendarId/settings/…`
  addresses redirect via `LegacyClubSettingsRedirect`) and use `components/settings/ClubSettingsLayout` (+
  `ClubSettingsTabs`: only locations and target groups; the feeds pages are standalone without tabs) and `useClubSettingsPage()` (club, role, `canEdit` / `isAdmin`,
  `readOnly` = role only, no archived state, `activeCalendars`, `routes` = `clubSettingsRoutes(clubId)`). A new feed
  starts with all active calendars of the club selected. `ProtectedRoute` treats `/clubs/:id/settings/*` as club
  context (shell calendar = last used). Properties, features, holiday calendars and general settings stay below
  the calendar.
  Pure logic in `src/lib/settings/` (`masterList.ts` name check + delete consequences from the API's `usage`, `location.ts`, `holidays.ts`,
  `timezones.ts`) with Vitest tests. Pages: `CalendarSettingsPage` (name, time zone; archiving / duplicating /
  deleting are NOT here, a text link leads to the club page), `PropertiesPage` / `FeaturesPage` (calendar level; `MasterList kind=…`),
  `TargetGroupsPage` / `LocationsPage` (club level since Paket 5; `MasterList kind=…` / locations), `HolidayCalendarsPage` (calendar level).
  - `MasterList` (properties, features, audiences): add form, list, rename in a `FormDialog` (label, error summary,
    Enter saves, Escape cancels, focus returns to the edit button), delete with the usage counts of the list
    endpoint (`usage: {events, templates, feeds?, eventNames}`; the list is refetched when the dialog opens, no event
    or template lists). The backend rejects duplicate names with 422 `code: "duplicate_name"` (`isDuplicateNameError`
    in `lib/api.ts`, `ApiError.code`); the form shows it at the field.
  - Places: `components/locations/` – `LocationPanel` (form), the street field is an `AutocompleteInput` (address suggestions via the backend, `addressSuggest.ts`; on blur it fills empty zip/city/country from a complete result list), `CoordinateFields` (keyboard alternative to the map), `PositionMap` (click / drag, lazy),
    `LocationsOverviewMap` (pins are buttons, the list is the alternative), `MapBoundary` (a failing map never
    takes the page down), `useMapbox` / `mapboxProxy`. `HolidayPreview` (next twelve months, loaded on open).
  - `useCalendarActions(clubId, calendarId, name, { stay })` = archive / unarchive / duplicate / delete with toasts;
    `stay` keeps the club page in place; duplicating sends the localized name in the POST. `CalendarDeleteDialog` =
    delete confirmation with the calendar's `eventCount` (single GET when it opens).
- Publish, club, profile:
  - Feeds: list `/clubs/:clubId/settings/feeds` (`pages/settings/FeedsPage`: status as `StatusBadge` word + icon (`public` /
    `club` "Vereinsintern" / `private`), audience
    tags, addresses behind a disclosure, first feed open, a freshly saved one opens via router state `{ open }`),
    `…/settings/feeds/new` and `…/settings/feeds/:feedId` (`FeedEditPage`: name, visibility radio group with three
    states `PUBLIC` / `CLUB` / `PRIVATE` (default `CLUB`), no search engine option (a feed is indexable iff it is `PUBLIC`, API field `indexable`), saving a saved private feed as `PUBLIC`/`CLUB` asks first (`ConfirmDialog`, `dropsSecret`), audience chips,
    secret panel (only `PRIVATE`) with "Geheimnis neu erzeugen" behind a `ConfirmDialog`, addresses of the saved feed; archived
    calendars are read-only). The page loads its feed with the single GET (`useFeed`, key `["feeds", clubId, "one", feedId]`). UI in
    `components/feeds/` (`FeedAccess` = CopyFields for secret / web link, `AudienceTags`, `useFeeds`);
    pure logic in `src/lib/feeds/` (`feedAddresses`: the web link; private feeds carry `?secret=`, public and club
    feeds never; `feedStatus`, `requiresSecret`, form values, payload). Visibility is always icon + word (no emoji icons). Type `FeedVisibility` in `lib/types.ts`.
  - Feed self-join admin UI: club general tab shows `components/club/FeedSignupSection` (admins; radio group `off` / `internal` / `public` = club setting `feedSignup`, saved on change via `PATCH /api/clubs/:id`). The edit page of a saved PRIVATE feed shows `components/feeds/FeedAssignments` ("Zugewiesene Mitglieder", editors and admins; count badge from `assignedCount`, server-side paginated list `GET …/feeds/:id/members` (10/page, `q`, `source` filter), source `Tag`, per-row remove and checkbox selection through `POST …/members/bulk-delete` behind a `ConfirmDialog`, add dialog with a paginated club member search (`GET …/members?q`) or a pasted e-mail list (`parseEmailList` in `lib/feeds/assignments.ts`: split, lower-case, de-duplicate, max 500) showing `{added, unknown}`); the section is hidden for other visibilities. The secret rotation dialog offers `revokeClaimed` (checkbox, only sent when ticked). The feeds list shows the assigned count on private feeds.
  - Club roles (viewer < editor < admin, `lib/club/permissions.ts`): write controls are gated, never shown disabled-with-403.
    `useEventPage()` (calendar pages, dialogs, settings) exposes `roleCanEdit` (editor+), `isAdmin`, `canEdit` (role + calendar loaded and
    not archived), `readOnly` and `roleLoading`; an unknown role counts as no right. Events, templates, import and reference data need
    editor; calendar management (club page, general settings), club rename/delete and feed changes need admin; viewers get no feeds
    (`FeedsForbidden`, no request) and no import/feeds navigation entries. Create dialogs show the `forbidden` gate (`createGateState`).
    Tests: `mockApiGet` (`src/test/clubRole.ts`) answers `GET /api/clubs` with the wanted role; see `pages/__tests__/ClubRoles.test.tsx`.
  - Role `member` (below viewer; staff = viewer+, `isStaff` in `lib/club/permissions.ts`): a plain member may only use `/api/auth/me`,
    the club list, leaving the club, feed claim/membership and `my-subscription` / `my-feeds` / `my-events`; everything else is 403. The
    shell follows the role of the ACTIVE club (from `GET /api/clubs`, `ShellData.role`): `AppShell` requests no calendars for a member
    (`calendarId` null, no setup redirect, no calendar switcher, sidebar/tab bar with "Mein Verein" only) and redirects every path except
    `/clubs/:id/me` and `/profile` to Mein Verein (`memberMayOpen`); until the club list is loaded nothing else renders (no 403 requests).
    Club switch, `ClubCard`, `ClubsPage` (last club) and `useEnterClub` open Mein Verein for a member. Staff get "Mein Verein" as the
    first entry of the "Verein" nav group and a row on `MorePage`.
  - Mein Verein: `/clubs/:clubId/me` (`pages/MyClubPage`, every role, `lib/club/myClub.ts`; tabs via `HelpTabs`, URL `?tab=calendar|subscription`): tab "Kalender" = `components/myclub/MyCalendarTab`,
    tab "Abo" = `MySubscriptionTab`; "Verein verlassen" for every role uses `components/club/LeaveClubDialog` (shared with `MembersSection`; handles `last_member` / `last_admin`).
    "Kalender" reuses the feed page's view (`components/feed/PublicCalendarView`, state owned by the caller: date / view / `q` in the URL next to `tab`) with data from `my-events`;
    the audience chips (`my-feeds` `targetGroups`) start with the subscription's selection (empty = all, not sent to the server); changing them is local state only and is then sent as
    `targetGroupIds` (an explicit empty list = all), with the note "Aus deinem Abo vorausgewählt"; holidays stay visible while only audiences are selected (`holidaysWithGroups`). Empty states: no feed selected
    (link to the Abo tab), no events. Event details are the routed modal `pages/MyEventModal` (`/clubs/:clubId/me/events/:eventId`, `modalRoutes` kind `my`, background `/clubs/:id/me`; shares `EventDetail`
    of `PublicEventModal`, no one-event ICS; `memberMayOpen` allows the path). "Abo" = checkable feed rows (`StatusBadge`, calendar names, why accessible via `accessReason`, hint for private feeds) +
    `ChipSelect` of audiences, explicit save (`PUT my-subscription`, `useUnsavedChanges`, toasts) + the personal address (`PersonalLink` = `CopyField` + `components/feed/SubscribeButton`, the subscribe split button
    extracted from `FeedPage`). Renewing the personal link is NOT on this page: profile section `components/profile/CalendarSubscriptionSection` ("Mein Kalender-Abo", per club a `ConfirmDialog` and
    `rotate-secret`, the new address shown as `PersonalLink`). UI wording says "persönlicher Link", never "secret".
    API layer for the member endpoints: `lib/club/memberApi.ts` (functions, TanStack hooks `useMySubscription`, `useReplaceMySubscription`, `useRotateMySubscriptionSecret`,
    `useMyFeeds`, `useMyEvents`, `useMyEvent`, `useClaimFeed`, `useFeedMembership`, and `mySubscriptionAddresses` for the ICS/webcal address); types in `lib/types.ts`.
  - Club: `/clubs/:clubId` (`pages/ClubPage`, three tabs via `HelpTabs`, URL `?tab=general|calendars|members`, default general: general = `ClubNameSection` + delete-club card, calendars = `CalendarsSection`, members = `MembersSection`; in `components/club/`: `ClubNameSection`, `MembersSection` (table with role per member,
    remove / leave with `ConfirmDialog` (last admin guard); `InviteSection`: admins only, invite by e-mail with role (default editor), open
    invitations pending / expired with "send again" (expired only) and revoke), `CalendarsSection` (create form,
    one `CalendarRow` per calendar with open / duplicate / archive / delete, archived list with restore). Rows show "n Termine"
    (`eventCount`). Deleting the club asks to type its name (`ConfirmDialog` `requireText`) and names the scope from
    the club's counters (`clubDeleteConsequence`). Pure logic: `src/lib/club/`. The club picker (`ClubsPage` /
    `ClubCard`) shows the counters of `GET /api/clubs` and loads a club's calendars only when it is opened.
  - Profile: `/profile` (`pages/ProfilePage`, `components/profile/`: `AccountSection` (name via `updateUser({name})`;
    new e-mail (+ step-up) → `POST /api/auth/change-email`, the waiting address (`pendingEmail` of
    `/api/auth/me`) as banner with "Änderung verwerfen" (`DELETE …/change-email`)), `PasswordSection` (change with the current password and the step-up: the API returns new tokens, `login()` stores them,
    other devices are signed out; SSO-only: "Passwort per E-Mail festlegen" = forgot-password for the own address),
    `LinkedLoginsSection` (link: `POST /api/auth/oauth/{provider}/link-start` → `window.location.assign(url)`; the API
    comes back with `?link_provider=&link_proof=` and the page completes the link with this session's token
    (`POST …/link-complete {proof}`; the API refuses a flow started by another user: link-CSRF protection); unlink
    with `ConfirmDialog`, disabled with the "Mindestens eine Anmeldemethode muss bleiben" note when it is the last
    method (`isLastSignInMethod`); the page reads `?linked=` / `?link_error=` / `link_proof` once (banner + toast),
    removes them from the address and maps codes with `linkErrorKind`). After a failed submit the profile forms move
    focus to the first invalid field (`focusFirstInvalid`, `lib/focus.ts`; field errors are no live regions),
    `ReauthFields` (the proof inputs of the step-up dialog only: password, or for passwordless accounts the mailed 6-digit code with send button, purpose `step_up` = `POST /api/auth/step-up/code`, texts `stepUp.reauth.*`; helpers `reauthBody`, `reauthMissing`, `reauthFieldError` in `reauth.ts`),
    step-up confirmation (`lib/stepUp.ts` store + `components/auth/StepUpDialog`, mounted once in `App.tsx`): sensitive account actions (change password / e-mail, delete account, MFA enable / disable / backup codes / add, passkey add / delete) no longer carry a password or code in their body; `apiFetch` sends the header `X-Step-Up-Token` on `/api/auth/*` requests (or `stepUp: true`) and on a 403 `step_up_required` opens the dialog (`ensureStepUp`) and retries once; 403 `step_up_unavailable` refreshes the access token and retries; a cancelled dialog rejects with `ApiError` code `step_up_cancelled` (`isStepUpCancelled`, callers stay silent). The token (valid 10 min, not renewable) lives only in `sessionStorage` `cc_step_up` (never localStorage, never on the `cc-auth` channel, per tab), checked with a 5 s margin, and is cleared by `clearTokens()`, `login()` (new tokens / other user) and logout. The dialog loads `/api/auth/me` for `hasPassword` and the factors: password (or mailed code) plus, when `mfa.enforced`, authenticator code, backup code (toast with the remaining count) or passkey (`/api/auth/step-up/passkey/options` + `startAuthentication`) in one submit. Flows using it: `AccountSection`, `PasswordSection` (also keeps the current-password field), `DeleteAccountDialog` (also on `ConsentPage`), `MfaSection`/`MfaActionDialog` (confirm dialog without proof inputs), `MfaEnforceDialog`, `MfaDisableDialog`, `BackupCodesDialog`, `MfaAddDialog`; E2E helpers `confirmStepUp`, `confirmStepUpIfAsked`, `forgetStepUp`, `stepUpDialog`,
    `BackupCodeNotice` (`components/auth/`: once-only dialog after a backup-code sign-in, mounted in `ProtectedRoute`; the announcement is the in-memory store `lib/backupCodeNotice`, set by `MfaStep`, so it neither survives a reload nor returns; shows the remaining codes, MFA stays on, offers "Andere Geräte abmelden" (`POST /api/auth/sessions/sign-out-others`, new token pair stored with `login`, hook `useSignOutOtherSessions` in `lib/profile/mfa.ts`) and a link to the profile; a 0-codes warning), `MfaSection` (profile panel "Multi-Faktor-Authentifizierung (MFA)", replaces the passkey section: one row per method (authenticator app, each passkey with inline rename without confirmation and delete with the step-up confirmation, backup codes with "regenerate"), "MFA-Methode hinzufügen" opens `MfaAddDialog`; "MFA einschalten" (`MfaEnforceDialog`: `mfa/setup` backup codes + required acknowledgement + step-up, `mfa/enable`) only when `mfa.canEnforce`, "MFA ausschalten" (`MfaDisableDialog`, `mfa/disable`) instead when `mfa.enforced`; a warning banner with a regenerate button when 2 or fewer backup codes remain; `MfaActionDialog` is the shared confirm dialog of these actions, `BackupCodesDialog`/`BackupCodesView` show new codes once with copy and .txt download; mutations in `lib/profile/mfa.ts`, token pairs returned by disable and passkey deletion are stored with `login`; `mfa_last_passkey` is shown inline),
    `PreferencesSection` (date format, first weekday and language are saved on the account at once, theme only in
    this browser)). Without a last-used club the page uses the `AuthLayout` frame instead of the app shell. Pure
    logic: `src/lib/profile/`.
  - Dialog guidance: use a controlled `open` state for `ConfirmDialog` when the page re-renders while it is open
    (trigger mode closed the dialog when data arrived in the browser). `FormDialog` (shared) is the small dialog for
    forms, `Modal` the routed / large dialog; both build on `DialogFrame`.
  - Dialog stack (`ui/shared/dialogStack.ts`): Base UI nests a dialog rendered inside another one (delete / series
    scope / unsaved above the event dialog) into the outer portal and only sets `aria-hidden` on the dialog below,
    which stays tabbable (Tab after the last button ended up in the event dialog). `DialogFrame` (scrim) and
    `ConfirmDialog` (popup) therefore register as layers (`useDialogLayer`): every layer below the top one is
    `inert` until the ones above close (`open` false); Escape closes only the top dialog (Base UI), focus returns
    to the opener inside the dialog below. Build new dialogs on `DialogFrame` / `ConfirmDialog`, not on raw Base UI.
    E2E: `e2e/dialog-stack.spec.ts`.
  - Accessible names contain the visible text (WCAG 2.5.3, axe `label-content-name-mismatch`): an `aria-label` that
    differs from the visible text must start with it ("Gruppe bearbeiten: Name"); the mobile top bar's profile link
    shows the initials and names itself "AB, Mein Profil" (no `aria-label`).
- Public feed and accounts: `components/feed/SignedInBar` (first element of `PublicShell`; reads `AuthContext` via `useContext`, so public pages never force a login and work without a provider; an empty bar of the same height holds the place while a returning session is checked) and `components/feed/useFeedAccount` (entry of the subscribe split button by state: signed out = menu option that stashes the proof and goes to /login; member with the feed selected = default "In meinem Konto anzeigen"; member without it or staff = default "Zu meinem Konto hinzufügen" claims directly; non-member = default goes to the join page; hidden for 404 or when `canJoin`/`canClaim` are false; the membership answer has no club id, so the club is the unique one of the user's clubs with that name). Feed proof stash: `lib/feeds/feedProof` (`sessionStorage`, 1 h, like the invitation token; `/clubs` forwards once to `/feed/:id/join`; `SignInPage`/`SignupStep` send `feedProof`, SSO start gets `feed_id`/`secret`). `pages/FeedJoinPage` (`/feed/:feedId/join`, outside `ProtectedRoute`): moves `?secret=` into the stash, explicit confirmation ("Beitreten" for non-members, "Hinzufügen" for members), error states by code (`member_signup_disabled`, `feed_not_found`, quota, rate limit), unconfirmed address / consent gate keep the stash.
- Public access (no app shell, no sign-in): `pages/FeedPage` (`/feed/:feedId`) and the dialog
  `pages/PublicEventModal` (`/feed/:feedId/events/:eventId`, above the feed; a shared link shows the feed at the
  event's month below; unknown events, drafts and feed errors are states of the dialog) share `components/feed/` (`PublicShell` = skip link, brand row with the club name + `LangSwitch`,
  header, `<main id="main">`, footer (with the time zone note above it); `usePublicHead` sets `<meta name="referrer" content="no-referrer">` (the web server also sends `Referrer-Policy: no-referrer` for `/feed/*`; `X-Robots-Tag` only comes from the backend for `/api/feed/*`),
  `noindex, nofollow` unless `indexable === true` (from `feed.indexable` of the API: only `PUBLIC` feeds with the
  search engine option; club internal, private, loading and error states are noindex), and a title without the secret; `usePublicFeed` =
  react-query over `fetchPublicFeed` for the visible month grid (`from`/`to`, the previous month stays while loading)
  with `referrerPolicy: "no-referrer"`, no auth headers, no retries; `usePublicEvent` = the single-event endpoint for
  the dialog (placeholder from the feed cache; on 404 a one-day feed request tells "event not found" from "feed not
  found"); `PublicStates`
  = loading / private (403) / not found (404) / load error with retry; static map image (`<img>` of `/api/map/image/location/{id}?v=updatedAt`, no mapbox-gl on public routes), text
  alternative = address + "In Karten-App öffnen"). Pure logic in `src/lib/feeds/public.ts` (error kinds, the header (club and calendar name, zone,
  `eventCount`, `audiences`) comes from the API; "today" and the zone note use `feed.timezone`, the month view shows
  the calendar's holidays; filter, month counts, subscribe addresses, in-app
  paths that keep `?secret=`). View state lives in the URL (`date`, `view=list`, `q`, `groups`, plus `secret`); the event
  dialog keeps it as router state `background` without the secret. `MonthView`/`EventItem`/`CalendarLegend` take `publicView` / `showStatus` /
  `showDraft` (no status badges, no draft legend). The one-event ICS file is `buildEventIcs` (`lib/events/ics.ts`;
  in the event's effective zone from the API). `ThemeSwitch` (shared) is used by the profile only.
- Unsaved changes: `useUnsavedChanges(dirty)` (`src/lib/useUnsavedChanges.ts`) + `<UnsavedChangesDialog {...dialog}>`;
  intercepts in-app link clicks and `guard(fn)` navigation, `beforeunload`, and the browser's back / forward
  buttons (`useBlocker` for POP navigations, rendered by the dialog only inside the data router, so `<MemoryRouter>`
  tests work unchanged). Call `allow()` before navigating away after a save / delete.
- Event form draft (FRM-19): the event create / edit form autosaves its field values (no tokens) to localStorage
  `cc:draft:v1:<userId>:<calendarId>:<eventId|new>` (`lib/events/draft.ts`, hook `lib/events/useEventDraft.ts`): debounced 1 s,
  only with changes against the initial values, every storage access in try/catch. A differing draft is offered by a
  non-blocking `Banner` ("Wiederherstellen" / "Verwerfen", never applied automatically; restoring drops ids of
  deleted places / properties / features / target groups). Deleted on save, delete and "Änderungen verwerfen"; drafts older
  than 14 days or with a wrong shape are ignored and removed when read; `AuthProvider` clears all drafts on logout
  (and other users' drafts on login). Only the event form uses it.
- Icons: lucide-react via `<Icon glyph="..." />` (design glyph names, `shared/Icon.tsx`). No emojis as UI icons.
- All texts via i18n (`src/locales/de.json`, `en.json`); shared component texts under `ui.*`, shell under `shell.*`.
- Tests: Vitest + Testing Library (jsdom, setup in `src/test/setup.ts`, tests run in German).
- API errors: `lib/api.ts` throws `ApiError` (with `status` and the stable `code` of the RFC 7807 body) from
  `apiGet/apiPost/apiPatch/apiDelete` (all four read the body; 204 responses resolve to `undefined`); recognise
  errors by `code` (status: `apiErrorStatus`), never by the message (the server's `detail`) (e.g. `email_taken`,
  `email_not_verified`, `unknown_reference`, `duplicate_name`, `too_many_events`, `invalid_reset_token`, `invalid_credentials`, `no_password`,
  `last_login_method`, `account_in_use` (SSO `link-complete`), `ics_fetch_failed` (holiday calendar address; `ApiError.field` names the input, e.g. `validation_failed` on `url`),
  `member_not_found` (removing a member someone else removed: treated as done); every error body is RFC 7807,
  a 401 (`invalid_token` / `token_expired` / `missing_token`) of a request with a token triggers the refresh in
  `apiFetch` (by status, not code); list in
  `docs/api/openapi.yaml`, `ErrorCode`). SSO callback errors (`?error=`) map to their own texts via
  `lib/ssoError.ts` (`auth.login.ssoError.<code>`, unknown codes → `generic`). SSO sign-in is bound to the tab (PKCE, `lib/ssoBinding.ts`): `SignInPage` sends `code_challenge` to the start route and keeps the verifier in `sessionStorage`; `AuthCallbackPage` takes it (single use) and sends it as `code_verifier`, without it the page goes to `/login?error=invalid_code_verifier` without a request. The react-query
  default `retry` (`lib/queryRetry.ts`) does not retry 4xx (401/403/404 show their error state at once), 5xx and
  network errors get 2 retries. Every request times out (`fetchWithTimeout` in `lib/api.ts`: 30 s, 120 s for import, import preview and ICS/PDF export) with `ApiError` `code: "request_timeout"`, `status` 0 (shown like a network error; a refresh timeout does not end the session; the caller's own `signal` still aborts as a plain AbortError). Auth: `lib/auth-context.ts` (context + `useAuth`), `lib/AuthProvider.tsx` (provider);
  button styling is `buttonClass()` in `ui/shared/` (the old shadcn component files in `components/ui/` are gone;
  only the shadcn CSS variables and `tw-animate-css` remain as a base in `index.css`). Lint: `--max-warnings 0`.
- Club / calendar switch: the last calendar per club is stored at the membership on the server (`PATCH
/api/auth/me {lastClubId, lastCalendarId}` from `AppShell`, read as `lastCalendarId` of `GET /api/clubs`; `AppShell`
  mirrors it into the cached `["clubs"]` list); `pickCalendar(…, rememberedId)` prefers it (only if it exists and is
  not archived), then the account's last pair, then the first active calendar. The old localStorage keys
  (`lastCalendar:*`) are removed at start (`lib/legacyStorage.ts`). `AppShell` exposes
  `ShellData.contextState` (`loading | ready | unavailable`): a club that is not the user's or whose calendars fail to
  load shows "Nicht verfügbar" + link to the club picker in Sidebar / Topbar instead of "Laden…".
- Calendar switcher (`CalendarMenuItems`): stays in the current section of the new calendar (`layout/calendarSwitchPath.ts`: events, export, import, templates, more, settings pages; an open template or event falls back to its list, club pages to the calendar). `AppShell` keys the `Outlet` by `calendarId`, so page-local state resets and queries (keys contain the calendar id) reload.
- History focus: `lib/historyFocus.ts` (`useHistoryFocus` in `BackgroundRoutes`) moves focus to the page `h1`
  (else `#main`) after every route change between different pages (link, redirect, back / forward) unless the page
  already focused something in `#main`; not for dialogs (own focus logic) or query-only changes. Page titles:
  `usePageTitle(title)` (`lib/usePageTitle.ts`, "<title> – Club Calendar", i18n) in every page / layout; routed modals
  never set a title. Dialog titles are `h2` (the page keeps the only `h1`).
- Import details: the step is kept in the history state (`{ importStep: "review" | "done" }`, same URL), so back /
  forward move between the steps; `useUnsavedChanges(dirty, { blockSamePath: true })` also holds same-path POPs; the
  result step replaces the review entry (back never reaches a second import). Files are decoded by
  `lib/import/decode.ts` (strict UTF-8, else windows-1252 with a notice in the review; BOM / UTF-16 handled), TZIDs
  go through `lib/import/windowsZones.ts` (Windows names -> IANA, unknown -> null). `ReviewGroup` renders the first
  100 events of a group and adds 100 per "weitere anzeigen" (selection and counts cover all events; measured with
  5000 events in `e2e/import-large.spec.ts`).
- Contrast: tags carry a 3:1 outline (`--border-strong`), skeletons use `--skeleton` / `--skeleton-pulse` plus the
  same outline; `src/lib/__tests__/contrast.test.ts` computes the ratios of the tokens for both themes.

## Accessibility and structure rules

- Semantics first: real `button` / `a` / `label` elements, `aria-current` for the active navigation item,
  `aria-pressed` for toggle buttons, a skip link in every frame, a visible focus indicator, tap targets of at least
  44px (`min-h-tap` / `size-tap`).
- Status is never conveyed by color alone: always icon + word (`StatusBadge`, `Tag`); colors come from the tokens
  (contrast checked per theme, see "Contrast").
- Both languages (de + en) for every new text; the theme is `light|dark|system`, the choice lives in the profile.
- Reusable building blocks go into `components/ui/shared/` (export via `index.ts`), page-specific ones into
  `components/<area>/`; check for an existing component before building a new one, no duplicates.
- Existing routes and URLs stay stable unless a new step requires a new one.
- Update or add Vitest / Playwright tests with every change (adjust outdated tests, do not delete them to get green);
  before handing over run `npm run build -w frontend`, `npm test -w frontend` and `npm run lint -w frontend`.

## End-user help (`/help`, `frontend/docs/`, `src/docs/`)

Overview and syntax: "End-user documentation (/help)" in the root `CLAUDE.md`.

- **Writing rule:** Help pages are for non-technical users: plain, short, task-oriented language; no feature advertising and no technical background (protocols, libraries, security internals) unless the user must act on it; explain a cross-cutting topic once on its natural page and link to it instead of repeating it.

- **Add a page:** create `frontend/docs/de/<section>/<name>.md` and the same file under `en/` (frontmatter `title`, `order`, `description`); `npm run dev`/`build` regenerates `src/docs/slugs.generated.ts` (commit it). Do not use the slug `subscribe`. Section folders carry a two-digit prefix (`10-getting-started/`) that sets the section order in the sidebar and `/help` and is stripped from slugs, URLs and section ids (`10-getting-started/sign-up.md` is `getting-started/sign-up`); unprefixed folders sort last (alphabetical), root pages first; duplicate prefixes or duplicate slugs after stripping fail the build; pages inside a section sort by `order`, then title. A section index page is `<section>/index.md` (shown at `/help/<section>`, its title is the sidebar section title); without it `/help/<section>` shows a generated table of contents (title + description of the direct pages and child folders, ordered by `order`) and the sidebar shows the humanised folder name.
- **Tabs:** `:::tabs [key=<param>] [platform]`, then one `:::tab <id> <label>` ... `:::` block per tab, then a final `:::` closing the group (only whitespace between tabs; callouts and nesting are not allowed inside; no `:::tabs` fences inside code blocks). Rendered by `DocRenderer` with `HelpTabs`; the active tab is mirrored into the query param `key` (default `tab`, replace navigation; must be unique per page); the param wins over `platform` (preselect from `detectPlatform`: ios->ios, macos->macos, windows->outlook, android/other->google, only if such a tab id exists), else the first tab. Compile errors: empty group, duplicate ids, unknown attributes, missing label, unclosed blocks. Tab text is in the search index.
- **Add a screenshot:** reference `![alt](shot:<id>)`, add a spec `e2e/docs/<name>.docs.ts` (a `describe` per language whose title contains `(de)` / `(en)`, shots via `shot()` from `e2e/docs/shots.ts`), run `npm run docs:screenshots` (E2E environment below) and commit the PNGs. The Playwright projects are `de` and `en` (Chromium `--lang` so native date/time inputs follow the language; the project name is the folder `docs/screenshots/<lang>/`); `shot()` uses `toHaveScreenshot` with `--update-snapshots=changed`, so renderer noise (a few pixels) keeps the committed PNG and real changes rewrite it (`-u all` forces a rewrite). Volatile dates are pinned (fixed clock; mask or rewrite text that shows the server date).
- **Sidebar sections:** `src/docs/HelpNav.tsx` renders every section as a disclosure (button with `aria-expanded`/`aria-controls`, region `inert` when closed, `.ap-collapse` motion); only the section of the shown page or table of contents starts open, navigation opens the target section, manual toggles persist while the help layout is mounted; root pages stay plain links; a section with an index page has a title link (to the index page) plus a separate chevron toggle button.
- **Link from a screen:** `<HelpLink page="getting-started/first-steps" anchor="...">label</HelpLink>` (`newTab` inside forms/dialogs); texts via i18n.
- **Files in `src/docs/`:** `types.ts` (languages, page types), `slugs.generated.ts` (generated slugs), `paths.ts` (`helpPath`, `useHelpUrl`), `HelpLink.tsx`, `HelpCenterLink.tsx` (the help link of sidebar, footers and MorePage; defaults to the help page of the current screen via `contextHelp.ts`, always `target="_blank"` + `rel="noopener noreferrer"` with an sr-only "opens in a new tab" hint; optional `to`/`label`/`className`), `contextHelp.ts` (`contextHelp`/`contextHelpPath`/`useContextHelpUrl`: ordered route-regex to `DocSlug` table, tab-dependent for `?tab=` on Mein Verein and Club, fallback `/help`; a new routed page needs a rule and a case in `__tests__/contextHelp.test.ts`), `DocRenderer.tsx` (hast tree to React), `HelpSearch.tsx` + `searchConfig.ts` (MiniSearch), `nav.ts` (navigation tree, `resolveHelpPath` = URL to page / section TOC / null), `virtual-docs.d.ts` (types of `virtual:docs`); page `src/pages/HelpPage.tsx`; compiler in `vite/docs-compiler.ts` and `vite/docs-plugin.ts`; tests in `src/docs/__tests__/`.

## E2E (Playwright, `frontend/e2e/`)

The suite registers users and writes data, so it only runs against an isolated local environment, never the dev
API / database (`frontend/.env.local` points `VITE_API_URL` at `https://api.club-calendar.test`).
`e2e/global-setup.ts` aborts with a clear message when `PLAYWRIGHT_BASE_URL`, `E2E_API_URL`, `VITE_API_URL` or the
`VITE_API_URL` the running dev server uses is not on localhost (`e2e/safety.ts`, tested in Vitest).

```bash
# 1. throwaway MySQL (there is no mysql_test service; never use the dev database)
docker run -d --name cc-verify-mysql -p 3360:3306 -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=club_calendar_test mysql:8.0.36
until mysql -h127.0.0.1 -P3360 -uroot -proot -e 'SELECT 1' >/dev/null 2>&1; do sleep 2; done
export DATABASE_URL="mysql://root:root@127.0.0.1:3360/club_calendar_e2e?serverVersion=8.0&charset=utf8mb4"
(cd backend && php bin/console doctrine:database:create --if-not-exists \
  && php bin/console doctrine:migrations:migrate -n && APP_ENV=dev php bin/console doctrine:fixtures:load -n)
# 2. backend (own terminal in the repo root, same DATABASE_URL; FRONTEND_URL / BACKEND_URL are not in .env)
FRONTEND_URL=http://localhost:5199 BACKEND_URL=http://localhost:3001 MAILER_DSN=null://null \
  php -S 127.0.0.1:3001 -t backend/public
# 3. frontend (own terminal in the repo root)
cd frontend && VITE_API_URL=http://localhost:3001 npx vite --port 5199 --strictPort
# 4. tests (repo root)
PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend
# afterwards: stop both servers, drop the database, remove the container
mysql -h127.0.0.1 -P3360 -uroot -proot -e "DROP DATABASE club_calendar_e2e"
docker rm -f cc-verify-mysql
```

`e2e/helpers.ts` runs backend console commands against the e2e database (`backendConsole`, default
`DATABASE_URL` of `club_calendar_e2e`, override `E2E_DATABASE_URL`): `app:user:verify` confirms registered users
(`createVerifiedUser`), `app:user:reset-link` gives reset links (`resetLinkFor`). Clean up afterwards also
`frontend/test-results` and `backend/var/cache/prod` (rate limiter state). Details: `docs/ops/E2E.md`.
`frontend/test-results/` and `playwright-report/` are git-ignored. Key presses that open a file chooser go through
`pressForFileChooser` (`e2e/helpers.ts`; a plain `Promise.all([waitForEvent, press])` races the interception).

## Shared UI Components

Before writing raw Tailwind layout divs in a page, check `src/components/ui/shared/` first
(import from `@/components/ui/shared`):

| Component                                       | Use for                                                                                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` / `LinkButton` / `IconButton`          | Buttons (primary, secondary, ghost, danger, danger-solid, ghost-danger)                                                                                                                |
| `SsoButton`                                     | Sign-in link of an identity provider in its brand style (Google/Microsoft/Apple logo + fixed wording `ui.sso.*`, light/dark variants; unknown provider falls back to a generic button) |
| `SplitButton`                                   | Primary action + menu of alternatives (e.g. "Termin anlegen")                                                                                                                          |
| `MenuButton`                                    | Button that opens a panel (menu list or popover with controls, e.g. the bulk bar of the event list)                                                                                    |
| `buttonClass()`                                 | Button styling for other elements (e.g. dialog triggers)                                                                                                                               |
| `Field` + `TextInput`/`TextArea`/`NativeSelect` | Label, hint, error, aria wiring (`group` mode for composite controls)                                                                                                                  |
| `PasswordField`                                 | Password input with show / hide toggle                                                                                                                                                 |
| `Toggle`                                        | On/off switch (`role="switch"`)                                                                                                                                                        |
| `Tag`                                           | Audience/property/feature labels (tones, optional emoji)                                                                                                                               |
| `StatusBadge`                                   | Status as icon + word (published, draft, holiday, archived, ...)                                                                                                                       |
| `Banner`                                        | Persistent info/warning/danger/success notice                                                                                                                                          |
| `Toaster` / `toast`                             | Short feedback (sonner, styled)                                                                                                                                                        |
| `EmptyState`                                    | Empty lists with explanation and next action                                                                                                                                           |
| `ConfirmDialog`                                 | Destructive confirmations incl. consequences (`tone="primary"`: neutral note); `alternative` = second action (series scope)                                                            |
| `FormDialog`                                    | Dialog with a form (title, fields, footer; Enter submits, Escape closes)                                                                                                               |
| `Modal` / `ModalFrame` / `useModalInitialFocus` | Large dialog with h2 (the page keeps the only h1), subtitle, x button (`closeLabel`), sizes, form layout; steps in one frame                                                           |
| `DialogFrame`                                   | Base dialog shell (scrim, focus trap, scroll lock, bottom sheet < 720px)                                                                                                               |
| `Disclosure`                                    | Collapsible disclosure with rotating chevron icon (`title`, `children`, `onToggle`); forwards ref to details element                                                                   |
| `CopyField`                                     | URLs/secrets with copy feedback                                                                                                                                                        |
| `Chip` / `ChipSelect` / `FilterPillGroup`       | Toggle chips, multi-select with create, filters                                                                                                                                        |
| `ChipCombobox`                                  | Only assigned entries as chips + trailing add chip that becomes an autosuggest combobox (last row creates inline; event form via `AssignmentFields variant="combobox"`)                |
| `EmojiPicker`                                   | Club-chosen symbols (presets, custom, emoji-mart lazy)                                                                                                                                 |
| `Stepper`                                       | Setup progress                                                                                                                                                                         |
| `LangSwitch`                                    | Language (bound to i18next)                                                                                                                                                            |
| `ThemeSwitch`                                   | Hell / Dunkel / Wie System (profile, public pages)                                                                                                                                     |
| `Skeleton`                                      | Loading placeholders (`aria-busy` on the region)                                                                                                                                       |
| `QrCode`                                        | QR code as `<img>` (data-URL SVG, black on white even in dark mode; `value`, `alt`, `size`; library `qr` lazy chunk, skeleton while loading, text fallback on failure)                 |
| `CodeInput`                                     | One-time code entry (six digit fields `[ ][ ][ ] - [ ][ ][ ]`, paste, auto-advance, `onComplete`; e-mail confirmation)                                                                 |
| `ErrorSummary`                                  | Form error list with links to the fields, focus after a failed submit                                                                                                                  |
| `UnsavedChangesDialog`                          | "Änderungen verwerfen?" (with `useUnsavedChanges`)                                                                                                                                     |
| `Logo`, `Icon`                                  | Brand mark, design glyphs                                                                                                                                                              |
| `AutocompleteInput`                             | Text input with a suggestion list (combobox; fuzzy `suggestions` or debounced `onSearch`, `onSelect`, `minChars`)                                                                      |
| `SearchInput`                                   | Search field (`ap-search`) for lists and the calendar                                                                                                                                  |
| `Pagination`                                    | Previous/next with "page X of Y" and total (server-side paged lists, e.g. club members)                                                                                                |
| `FullPageLoader`                                | Page loading state (`role="status"`, `aria-busy`); also the lazy-route Suspense fallback                                                                                               |

For Mapbox maps: use `useMapbox` from `src/components/locations/useMapbox.ts`. The tile/style/font proxy `/api/mapbox/*` is for signed-in users only: `mapboxProxy.ts` sends the access token as `Authorization: Bearer`, `useMapbox` renews it once after a 401 (`refreshSession`). Anonymous routes (public feed) must use the static image `/api/map/image/*`, never mapbox-gl.

## Build

`npm run build -w frontend` (type check + `vite build`) writes the SPA into `backend/public/` (`index.html` +
`assets/`, see `vite.config.ts`; `index.php` and `.htaccess` there stay). `backend/public/.htaccess` routes `/api/*`
to Symfony and everything else to `index.html`. Bundle check: the build prints chunk sizes; the entry chunk should
stay small (pages and dialogs are lazy, see Key conventions).
