# Frontend Stack

This is a **Vite + React + React Router** SPA (not Next.js).

Contents: [Key conventions](#key-conventions) · [Design system and areas](#design-system-and-areas) (tokens, theme,
shell, calendar, routed modals, events, import, templates, settings, publish / club / profile, public access,
unsaved changes, i18n, API errors, history focus, contrast) · [E2E](#e2e-playwright-frontende2e) ·
[Shared UI components](#shared-ui-components) · [Build](#build)

## Key conventions

- **CSP:** the app is served with `script-src 'self'`: no inline `<script>`, no `eval`/`new Function`, no third-party script/connect hosts (new hosts go into the CSP in `backend/public/.htaccess` AND `docker/Caddyfile`, see CLAUDE.md "Deployment"). Early boot code belongs in `public/*.js`.

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
  the production flow runs with `E2E_PREVIEW_URL`, see `docs/redesign/E2E.md`).
- i18n: German is bundled, English (`locales/en.json`) is a lazy chunk loaded by an inline i18next backend
  (`src/lib/i18n.ts`); `main.tsx` renders after `i18nReady`. A failed chunk import after a deploy reloads the page
  once (`vite:preloadError` in `main.tsx`, guard and error page: see "Error page and reload guard").

## Design system and areas

Background: `docs/redesign/PLAN.md` (plan, all phases done), `docs/redesign/BACKEND-GAPS.md` (open backend gaps and
operations), `docs/api/openapi.yaml` (API reference).

- Artboard-by-artboard mapping, deliberate deviations and open gaps: `docs/redesign/COVERAGE.md`. Confirmation
  dialogs follow the wording of the design's `Dialogs.dc.html` (see the table there).

- Tokens + component classes live in `src/index.css` (design `cc-tokens.css`, `.cc-*`, `.ap-*`, `.t-*`).
  Tailwind utilities map to tokens: `bg-surface`, `bg-surface-raised`, `bg-surface-sunken`, `text-ink`,
  `text-ink-muted`, `border-border`, `border-border-strong`, `bg-brand`, `text-on-brand`, `bg-brand-soft`,
  `bg-danger`, `bg-danger-soft`, `text-info`, `bg-highlight` (= design `--accent`, orange),
  `bg-tag-youth|adult|senior`, `min-h-tap`/`size-tap` (44px). Tailwind `accent` stays the shadcn hover surface.
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
  out of the URL at once; a signed-out visitor goes to /login, after the sign-in `/clubs` forwards back to `/invitations`; the
  token is cleared after use or when dead. Accepting switches to the club (`lib/useEnterClub`).
  `GuestRoute` sends signed-in users from /login, /signup, /verify-email, /forgot-password, /reset-password to /clubs.
  `AuthProvider` clears the tokens only when `/me` answers 401/403; network errors, 429 and 5xx keep them, retry twice
  and then set `sessionError` (retried on `online` / tab visible), during which `GuestRoute` shows the loader, not the form.
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
  `FilterBar`, `CalendarLegend`, `CalendarSkeleton`, `useCalendarData`, `useGridKeyboard` (roving tabindex).
  The calendar page keeps view and date in the URL (`?view=week&date=2026-10-08`). `useIsMobile()` /
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
  "Termin am … anlegen", FAB, chips / items; list: rows, create, FAB, empty states; templates: "Termin aus
  Vorlage"). Inside a modal `useModalNav()` (`lib/useModalNav.ts`): `step(to)` / `stepLink(to)` replace the
  history entry (one entry per dialog, so the browser's back button closes it), `close()` = history back (or
  replace to the background for deep links / `direct`), `setBackground(path)` lets a deep link show the event's
  month below. The modal routes share one `ModalFrame` layout route, so focus trap, scroll lock and focus return
  stay while the steps swap.
- Events (create / edit are routed dialogs; URL helpers in `components/events/routes.ts`):
  `…/events` list page (`?status=draft&q=`); dialogs (`pages/events/*Modal.tsx`): `…/events/new` choice
  (`?date=`, design EventNew), `…/events/new/form` form (`?date=`, `?templateId=` pre-fills from a template,
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
  an. Vergangene Termine bleiben.", then `PATCH …/event-series/{id}`; 409 / 422 / 403 / network as banners); `…/events/export` stays a page (downloads `GET …/events.ics` with the JWT via `apiFetch` + Blob + `a[download]`,
  error banner; the count preview uses `selectForExport`/`exportQuery` with the same rule). The list's bulk actions
  (publish / draft / delete) are one atomic `POST …/events/bulk` (fails as a whole, selection stays). Create dialogs of archived calendars show
  the archive notice instead of the form (`CreateGateBody`, `createGateState.ts`). Save / delete invalidate
  `["events", calendarId]`, toast, `unsaved.allow()`, close; save failures are also shown in the dialog (toasts sit
  behind the modal for screen readers). Pure logic in `src/lib/events/` (`form.ts` values/validation/payload,
  `list.ts` tabs/search/groups, `series.ts` series types, preview rows, rule text (`describeSeriesRule`) and the
  changed-fields diff for "all", `ics.ts` export query/selection + the one-event ICS writer `buildEventIcs` of the public event, `format.ts`), with Vitest tests.
  Events of a series (`seriesId` in every event list) carry the tag "Wiederkehrend" (`Tag tone="brand"`) in
  `EventsTable` and `EventItem` (`CalItem.recurring`), not on the month chips; bulk actions treat them like any event.
  UI in `components/events/` (`EventsTable`, `LocationSection` + lazy `EventLocationMap`, `StatusSeg`,
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
  Pure logic in `src/lib/settings/` (`masterList.ts` name check + delete consequences from the API's `usage`, `location.ts`, `holidays.ts`,
  `timezones.ts`) with Vitest tests. Pages: `CalendarSettingsPage` (name, time zone; archiving / duplicating /
  deleting are NOT here, a text link leads to the club page), `PropertiesPage` / `FeaturesPage` /
  `TargetGroupsPage` (thin wrappers of `<MasterList kind=…>`), `LocationsPage`, `HolidayCalendarsPage`.
  - `MasterList` (properties, features, audiences): add form, list, rename in a `FormDialog` (label, error summary,
    Enter saves, Escape cancels, focus returns to the edit button), delete with the usage counts of the list
    endpoint (`usage: {events, templates, feeds?, eventNames}`; the list is refetched when the dialog opens, no event
    or template lists). The backend rejects duplicate names with 422 `code: "duplicate_name"` (`isDuplicateNameError`
    in `lib/api.ts`, `ApiError.code`); the form shows it at the field.
  - Places: `components/locations/` – `LocationPanel` (form), `AddressSearch` (geocoding via the backend, live
    hit count), `CoordinateFields` (keyboard alternative to the map), `PositionMap` (click / drag, lazy),
    `LocationsOverviewMap` (pins are buttons, the list is the alternative), `MapBoundary` (a failing map never
    takes the page down), `useMapbox` / `mapboxProxy`. `HolidayPreview` (next twelve months, loaded on open).
  - `useCalendarActions(clubId, calendarId, name, { stay })` = archive / unarchive / duplicate / delete with toasts;
    `stay` keeps the club page in place; duplicating sends the localized name in the POST. `CalendarDeleteDialog` =
    delete confirmation with the calendar's `eventCount` (single GET when it opens).
- Publish, club, profile:
  - Feeds: list `…/settings/feeds` (`pages/settings/FeedsPage`: status as `StatusBadge` word + icon (`public` /
    `club` "Nur per Link" / `private`, plus `searchable` "Auffindbar" for indexable public feeds), audience
    tags, addresses behind a disclosure, first feed open, a freshly saved one opens via router state `{ open }`),
    `…/settings/feeds/new` and `…/settings/feeds/:feedId` (`FeedEditPage`: name, visibility radio group with three
    states `PUBLIC` / `CLUB` / `PRIVATE` (default `CLUB`), the `Toggle` "Für Suchmaschinen auffindbar" only for
    `PUBLIC` (switched off when the form leaves `PUBLIC`), saving a saved private feed as `PUBLIC`/`CLUB` asks first (`ConfirmDialog`, `dropsSecret`), audience chips,
    secret panel (only `PRIVATE`) with "Geheimnis neu erzeugen" behind a `ConfirmDialog`, addresses of the saved feed; archived
    calendars are read-only). The page loads its feed with the single GET (`useFeed`, key below
    `["feeds", calendarId]`, so list invalidations refresh it). UI in
    `components/feeds/` (`FeedAccess` = CopyFields for secret / ICS / webcal / web, `AudienceTags`, `useFeeds`);
    pure logic in `src/lib/feeds/` (`feedAddresses`: private feeds carry `?secret=` in every address, public and club
    feeds never; `feedStatus`, `requiresSecret`, `effectiveSearchable` (only `PUBLIC` sends `searchable: true`),
    form values, payload). Visibility is always icon + word (no emoji icons). Type `FeedVisibility` in `lib/types.ts`.
  - Club: `/clubs/:clubId` (`pages/ClubPage`, in `components/club/`: `ClubNameSection`, `MembersSection` (table,
    remove / leave with `ConfirmDialog`; `InviteSection`: invite by e-mail with a neutral answer (never "no account"), open
    invitations pending / expired with "send again" (expired only) and revoke), `CalendarsSection` (create form,
    one `CalendarRow` per calendar with open / duplicate / archive / delete, archived list with restore). Rows show "n Termine"
    (`eventCount`). Deleting the club asks to type its name (`ConfirmDialog` `requireText`) and names the scope from
    the club's counters (`clubDeleteConsequence`). Pure logic: `src/lib/club/`. The club picker (`ClubsPage` /
    `ClubCard`) shows the counters of `GET /api/clubs` and loads a club's calendars only when it is opened.
  - Profile: `/profile` (`pages/ProfilePage`, `components/profile/`: `AccountSection` (name via `updateUser({name})`;
    new e-mail + current password → `POST /api/auth/change-email`, the waiting address (`pendingEmail` of
    `/api/auth/me`) as banner with "Änderung verwerfen" (`DELETE …/change-email`); SSO-only accounts get a hint
    instead), `PasswordSection` (change with the current password: the API returns new tokens, `login()` stores them,
    other devices are signed out; SSO-only: "Passwort per E-Mail festlegen" = forgot-password for the own address),
    `LinkedLoginsSection` (link: `POST /api/auth/oauth/{provider}/link-start` → `window.location.assign(url)`; the API
    comes back with `?link_provider=&link_proof=` and the page completes the link with this session's token
    (`POST …/link-complete {proof}`; the API refuses a flow started by another user: link-CSRF protection); unlink
    with `ConfirmDialog`, disabled with the "Mindestens eine Anmeldemethode muss bleiben" note when it is the last
    method (`isLastSignInMethod`); the page reads `?linked=` / `?link_error=` / `link_proof` once (banner + toast),
    removes them from the address and maps codes with `linkErrorKind`). After a failed submit the profile forms move
    focus to the first invalid field (`focusFirstInvalid`, `lib/focus.ts`; field errors are no live regions),
    `PasskeysSection` (WebAuthn via `@simplewebauthn/browser`, "zuletzt benutzt am …" from `lastUsedAt` in the
    browser's time zone, remove with `ConfirmDialog`),
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
  `lib/ssoError.ts` (`auth.login.ssoError.<code>`, unknown codes → `generic`). The react-query
  default `retry` (`lib/queryRetry.ts`) does not retry 4xx (401/403/404 show their error state at once), 5xx and
  network errors get 2 retries. Auth: `lib/auth-context.ts` (context + `useAuth`), `lib/AuthProvider.tsx` (provider);
  button styling is `buttonClass()` in `ui/shared/` (the old shadcn component files in `components/ui/` are gone;
  only the shadcn CSS variables and `tw-animate-css` remain as a base in `index.css`). Lint: `--max-warnings 0`.
- Club / calendar switch: the last calendar per club is stored at the membership on the server (`PATCH
/api/auth/me {lastClubId, lastCalendarId}` from `AppShell`, read as `lastCalendarId` of `GET /api/clubs`; `AppShell`
  mirrors it into the cached `["clubs"]` list); `pickCalendar(…, rememberedId)` prefers it (only if it exists and is
  not archived), then the account's last pair, then the first active calendar. The old localStorage keys
  (`lastCalendar:*`) are removed at start (`lib/legacyStorage.ts`). `AppShell` exposes
  `ShellData.contextState` (`loading | ready | unavailable`): a club that is not the user's or whose calendars fail to
  load shows "Nicht verfügbar" + link to the club picker in Sidebar / Topbar instead of "Laden…".
- History focus: `lib/historyFocus.ts` (`useHistoryFocus` in `BackgroundRoutes`) moves focus to the page `h1`
  (else `#main`) after back / forward between different pages; not for dialogs (own focus logic) or query-only changes.
- Import details: the step is kept in the history state (`{ importStep: "review" | "done" }`, same URL), so back /
  forward move between the steps; `useUnsavedChanges(dirty, { blockSamePath: true })` also holds same-path POPs; the
  result step replaces the review entry (back never reaches a second import). Files are decoded by
  `lib/import/decode.ts` (strict UTF-8, else windows-1252 with a notice in the review; BOM / UTF-16 handled), TZIDs
  go through `lib/import/windowsZones.ts` (Windows names -> IANA, unknown -> null). `ReviewGroup` renders the first
  100 events of a group and adds 100 per "weitere anzeigen" (selection and counts cover all events; measured with
  5000 events in `e2e/import-large.spec.ts`).
- Contrast: tags carry a 3:1 outline (`--border-strong`), skeletons use `--skeleton` / `--skeleton-pulse` plus the
  same outline; `src/lib/__tests__/contrast.test.ts` computes the ratios of the tokens for both themes.

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
`frontend/test-results` and `backend/var/cache/prod` (rate limiter state). Details: `docs/redesign/E2E.md`.
`frontend/test-results/` and `playwright-report/` are git-ignored. Key presses that open a file chooser go through
`pressForFileChooser` (`e2e/helpers.ts`; a plain `Promise.all([waitForEvent, press])` races the interception).

## Shared UI Components

Before writing raw Tailwind layout divs in a page, check `src/components/ui/shared/` first
(import from `@/components/ui/shared`):

| Component                                       | Use for                                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Button` / `LinkButton` / `IconButton`          | Buttons (primary, secondary, ghost, danger, danger-solid, ghost-danger)                                                     |
| `SplitButton`                                   | Primary action + menu of alternatives (e.g. "Termin anlegen")                                                               |
| `buttonClass()`                                 | Button styling for other elements (e.g. dialog triggers)                                                                    |
| `Field` + `TextInput`/`TextArea`/`NativeSelect` | Label, hint, error, aria wiring (`group` mode for composite controls)                                                       |
| `PasswordField`                                 | Password input with show / hide toggle                                                                                      |
| `Toggle`                                        | On/off switch (`role="switch"`)                                                                                             |
| `Tag`                                           | Audience/property/feature labels (tones, optional emoji)                                                                    |
| `StatusBadge`                                   | Status as icon + word (published, draft, holiday, archived, ...)                                                            |
| `Banner`                                        | Persistent info/warning/danger/success notice                                                                               |
| `Toaster` / `toast`                             | Short feedback (sonner, styled)                                                                                             |
| `EmptyState`                                    | Empty lists with explanation and next action                                                                                |
| `ConfirmDialog`                                 | Destructive confirmations incl. consequences (`tone="primary"`: neutral note); `alternative` = second action (series scope) |
| `FormDialog`                                    | Dialog with a form (title, fields, footer; Enter submits, Escape closes)                                                    |
| `Modal` / `ModalFrame` / `useModalInitialFocus` | Large dialog with h1, subtitle, x button (`closeLabel`), sizes, form layout; steps in one frame                             |
| `DialogFrame`                                   | Base dialog shell (scrim, focus trap, scroll lock, bottom sheet < 720px)                                                    |
| `CopyField`                                     | URLs/secrets with copy feedback                                                                                             |
| `Chip` / `ChipSelect` / `FilterPillGroup`       | Toggle chips, multi-select with create, filters                                                                             |
| `EmojiPicker`                                   | Club-chosen symbols (presets, custom, emoji-mart lazy)                                                                      |
| `Stepper`                                       | Setup progress                                                                                                              |
| `LangSwitch`                                    | Language (bound to i18next)                                                                                                 |
| `ThemeSwitch`                                   | Hell / Dunkel / Wie System (profile, public pages)                                                                          |
| `Skeleton`                                      | Loading placeholders (`aria-busy` on the region)                                                                            |
| `CodeInput`                                     | One-time code entry (six digit fields `[ ][ ][ ] - [ ][ ][ ]`, paste, auto-advance, `onComplete`; e-mail confirmation)      |
| `ErrorSummary`                                  | Form error list with links to the fields, focus after a failed submit                                                       |
| `UnsavedChangesDialog`                          | "Änderungen verwerfen?" (with `useUnsavedChanges`)                                                                          |
| `Logo`, `Icon`                                  | Brand mark, design glyphs                                                                                                   |
| `SearchInput`                                   | Search field (`ap-search`) for lists and the calendar                                                                       |
| `FullPageLoader`                                | Page loading state (`role="status"`, `aria-busy`); also the lazy-route Suspense fallback                                    |

For Mapbox maps: use `useMapbox` from `src/components/locations/useMapbox.ts`. The tile/style/font proxy `/api/mapbox/*` is for signed-in users only: `mapboxProxy.ts` sends the access token as `Authorization: Bearer`, `useMapbox` renews it once after a 401 (`refreshSession`). Anonymous routes (public feed) must use the static image `/api/map/image/*`, never mapbox-gl.

## Build

`npm run build -w frontend` (type check + `vite build`) writes the SPA into `backend/public/` (`index.html` +
`assets/`, see `vite.config.ts`; `index.php` and `.htaccess` there stay). `backend/public/.htaccess` routes `/api/*`
to Symfony and everything else to `index.html`. Bundle check: the build prints chunk sizes; the entry chunk should
stay small (pages and dialogs are lazy, see Key conventions).
