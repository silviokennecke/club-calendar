# Frontend Stack

This is a **Vite + React + React Router** SPA (not Next.js).

Contents: [Key conventions](#key-conventions) · [Design system and areas](#design-system-and-areas) (tokens, theme,
shell, calendar, routed modals, events, import, templates, settings, publish / club / profile, public access,
unsaved changes, i18n, API errors, history focus, contrast) · [E2E](#e2e-playwright-frontende2e) ·
[Shared UI components](#shared-ui-components) · [Build](#build)

## Key conventions

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

Background: `docs/redesign/PLAN.md` (plan, all phases done), `docs/redesign/BACKEND-GAPS.md` (what the backend
does not offer yet and how the frontend works around it).

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
  club), `?clubId=` continues at step 2 for that club); `/clubs` is the club picker (`?select=1` skips the last-calendar redirect);
  `GuestRoute` sends signed-in users from /login, /signup, /forgot-password to /clubs.
- Context switcher menus (`layout/ContextMenu.tsx`): disclosure with Escape, arrow keys, Home/End, Tab-out closes.
- Calendar (no FullCalendar): pure date logic in `src/lib/calendar/` (`dates.ts` ISO-date arithmetic in UTC,
  month grid, ISO weeks, `todayIn(timeZone)`; `items.ts` events/holidays as inclusive ranges, week lane layout,
  `shiftEventDates`; `format.ts` Intl labels in the current language; `view.ts` URL view/anchor, ranges, grid keys),
  all with Vitest tests. UI in `components/calendar/`: `MonthView` (desktop `MonthBoard` with event bars +
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
  `focusAfterModalClose(eventSelector(id))` focuses the saved event via `data-event-id`, else the opener, else
  `#main`). Openers pass `state={openModalState(location)}` (calendar: create, split button, day panel
  "Termin am … anlegen", FAB, chips / items; list: rows, create, FAB, empty states; templates: "Termin aus
  Vorlage"). Inside a modal `useModalNav()` (`lib/useModalNav.ts`): `step(to)` / `stepLink(to)` replace the
  history entry (one entry per dialog, so the browser's back button closes it), `close()` = history back (or
  replace to the background for deep links / `direct`), `setBackground(path)` lets a deep link show the event's
  month below. The modal routes share one `ModalFrame` layout route, so focus trap, scroll lock and focus return
  stay while the steps swap.
- Events (create / edit are routed dialogs; URL helpers in `components/events/routes.ts`):
  `…/events` list page (`?status=draft&q=`); dialogs (`pages/events/*Modal.tsx`): `…/events/new` choice
  (`?date=`, design EventNew), `…/events/new/form` form (`?date=`, `?templateId=` pre-fills from a template,
  EventNewForm), `…/events/new/template` picker (EventNewTemplate), `…/events/new/template/:templateId` single event /
  series preview (series creation disabled, EventSeries), `…/events/:eventId` edit (EventForm, read-only in
  archived calendars); `…/events/export` stays a page (client-side ICS). Create dialogs of archived calendars show
  the archive notice instead of the form (`CreateGateBody`, `createGateState.ts`). Save / delete invalidate
  `["events", calendarId]`, toast, `unsaved.allow()`, close; save failures are also shown in the dialog (toasts sit
  behind the modal for screen readers). Pure logic in `src/lib/events/` (`form.ts` values/validation/payload,
  `list.ts` tabs/search/groups, `series.ts` rule dates + holidays, `ics.ts` export, `format.ts`), with Vitest tests.
  UI in `components/events/` (`EventsTable`, `LocationSection` + lazy `EventLocationMap`, `StatusSeg`,
  `CreateGate`, `useEventResources`, `useEventPage`, `ArchivedCreateGuard` for the import / template / feed pages).
- Import: `…/import` is one page with a Stepper (Datei, Prüfen, Fertig; state in `pages/ImportPage.tsx`,
  UI in `components/import/`: `ImportUpload` file input + drop zone, `ImportReview` bulk panel / groups / summary bar,
  `ReviewGroup`, `ImportEditDialog`, `ImportDone`). Pure logic in `src/lib/import/` (`ics.ts` parser incl. unfolding,
  TZID/UTC, all-day end, skipped events; `review.ts` items, groups by name, place matching, bulk id diffs, duplicates,
  payload, chunks of 500) with Vitest tests. No backend dry run: the file is parsed in the browser, only the reviewed
  events are sent (new places are created first via `POST …/locations`).
- Templates: own routed pages `…/templates` (`TemplatesPage`: cards, `?q=` search, delete dialog),
  `…/templates/new` and `…/templates/:templateId` (`TemplateEditPage`, read-only in archived calendars); pure logic in
  `src/lib/templates/` (`form.ts`). `components/events/AssignmentFields` (properties / features / target groups with
  inline creation) is shared by the event form, the template form and the import review.
- Settings: all pages below `…/settings` use `components/settings/SettingsLayout` (heading with club and
  calendar, `SettingsTabs`, the read-only banner of archived calendars with "Archivierung aufheben", skeleton /
  error states; `wide` for the places page). `useSettingsPage()` = `useEventPage()` + club + `readOnly`.
  Pure logic in `src/lib/settings/` (`masterList.ts` name check + usage counts, `location.ts`, `holidays.ts`,
  `timezones.ts`) with Vitest tests. Pages: `CalendarSettingsPage` (name, time zone; archiving / duplicating /
  deleting are NOT here, a text link leads to the club page), `PropertiesPage` / `FeaturesPage` /
  `TargetGroupsPage` (thin wrappers of `<MasterList kind=…>`), `LocationsPage`, `HolidayCalendarsPage`.
  - `MasterList` (properties, features, audiences): add form, list, rename in a `FormDialog` (label, error summary,
    Enter saves, Escape cancels, focus returns to the edit button), delete with the usage counts (it loads all
    events and templates when the dialog opens).
  - Places: `components/locations/` – `LocationPanel` (form), `AddressSearch` (geocoding via the backend, live
    hit count), `CoordinateFields` (keyboard alternative to the map), `PositionMap` (click / drag, lazy),
    `LocationsOverviewMap` (pins are buttons, the list is the alternative), `MapBoundary` (a failing map never
    takes the page down), `useMapbox` / `mapboxProxy`. `HolidayPreview` (next twelve months, loaded on open).
  - `useCalendarActions(clubId, calendarId, name, { stay })` = archive / unarchive / duplicate / delete with toasts;
    `stay` keeps the club page in place. `CalendarDeleteDialog` = delete confirmation with event / template / feed
    counts.
- Publish, club, profile:
  - Feeds: list `…/settings/feeds` (`pages/settings/FeedsPage`: visibility as `StatusBadge` word + icon, audience
    tags, addresses behind a disclosure, first feed open, a freshly saved one opens via router state `{ open }`),
    `…/settings/feeds/new` and `…/settings/feeds/:feedId` (`FeedEditPage`: name, visibility radios, audience chips,
    secret panel with "Geheimnis neu erzeugen" behind a `ConfirmDialog`, addresses of the saved feed; archived
    calendars are read-only). The backend has no single-feed GET, the page picks the feed from the list. UI in
    `components/feeds/` (`FeedAccess` = CopyFields for secret / ICS / webcal / web, `AudienceTags`, `useFeeds`);
    pure logic in `src/lib/feeds/` (`feedAddresses`: private feeds carry `?secret=` in every address, form values,
    payload). Visibility is always icon + word (no emoji icons).
  - Club: `/clubs/:clubId` (`pages/ClubPage`, in `components/club/`: `ClubNameSection`, `MembersSection` (table,
    remove / leave with `ConfirmDialog`, add by e-mail with 404 -> "no account"), `CalendarsSection` (create form,
    one `CalendarRow` per calendar with open / duplicate / archive / delete, archived list with restore). Deleting
    the club asks to type its name (`ConfirmDialog` `requireText`). Pure logic: `src/lib/club/`.
  - Profile: `/profile` (`pages/ProfilePage`, `components/profile/`: `LinkedLoginsSection` (read-only, link / unlink
    disabled "Bald verfügbar"), `PasskeysSection` (WebAuthn via `@simplewebauthn/browser`, remove with
    `ConfirmDialog`), `PreferencesSection` (date format, first weekday and language are saved on the account at
    once, theme only in this browser)). Without a last-used club the page uses the `AuthLayout` frame instead of
    the app shell. Pure logic: `src/lib/profile/`.
  - Dialog guidance: use a controlled `open` state for `ConfirmDialog` when the page re-renders while it is open
    (trigger mode closed the dialog when data arrived in the browser). `FormDialog` (shared) is the small dialog for
    forms, `Modal` the routed / large dialog; both build on `DialogFrame`.
- Public access (no app shell, no sign-in): `pages/FeedPage` (`/feed/:feedId`) and the dialog
  `pages/PublicEventModal` (`/feed/:feedId/events/:eventId`, above the feed; a shared link shows the feed at the
  event's month below; unknown events, drafts and feed errors are states of the dialog) share `components/feed/` (`PublicShell` = skip link, brand row with `LangSwitch` +
  `ThemeSwitch`, header, `<main id="main">`, footer; `usePublicHead` sets `<meta name="referrer" content="no-referrer">`,
  `noindex` when `?secret=` is present or the page is an error state and a title without the secret; `usePublicFeed` =
  react-query over `fetchPublicFeed` with `referrerPolicy: "no-referrer"`, no auth headers, no retries; `PublicStates`
  = loading / private (403) / not found (404) / load error with retry; lazy `PublicEventMap` with `useMapbox`, text
  alternative = address + "In Karten-App öffnen"). Pure logic in `src/lib/feeds/public.ts` (error kinds, `feedTimeZone` =
  most frequent event zone because the API has none, audiences, filter, month counts, subscribe addresses, in-app
  paths that keep `?secret=`). View state lives in the URL (`date`, `view=list`, `q`, `groups`, plus `secret`); the event
  dialog keeps it as router state `background` without the secret. `MonthView`/`EventItem`/`CalendarLegend` take `publicView` / `showStatus` /
  `showDraft` (no status badges, no draft legend). The one-event ICS file is `buildEventIcs` (`lib/events/ics.ts`;
  floating local time when no zone is known). `ThemeSwitch` (shared) is also used by the profile.
- Unsaved changes: `useUnsavedChanges(dirty)` (`src/lib/useUnsavedChanges.ts`) + `<UnsavedChangesDialog {...dialog}>`;
  intercepts in-app link clicks and `guard(fn)` navigation, `beforeunload`, and the browser's back / forward
  buttons (`useBlocker` for POP navigations, rendered by the dialog only inside the data router, so `<MemoryRouter>`
  tests work unchanged). Call `allow()` before navigating away after a save / delete.
- Icons: lucide-react via `<Icon glyph="..." />` (design glyph names, `shared/Icon.tsx`). No emojis as UI icons.
- All texts via i18n (`src/locales/de.json`, `en.json`); shared component texts under `ui.*`, shell under `shell.*`.
- Tests: Vitest + Testing Library (jsdom, setup in `src/test/setup.ts`, tests run in German).
- API errors: `lib/api.ts` throws `ApiError` (with `status`) from `apiGet/apiPost/apiPatch/apiDelete`. The react-query
  default `retry` (`lib/queryRetry.ts`) does not retry 4xx (401/403/404 show their error state at once), 5xx and
  network errors get 2 retries. Auth: `lib/auth-context.ts` (context + `useAuth`), `lib/AuthProvider.tsx` (provider);
  button styling is `buttonClass()` in `ui/shared/` (the old shadcn component files in `components/ui/` are gone;
  only the shadcn CSS variables and `tw-animate-css` remain as a base in `index.css`). Lint: `--max-warnings 0`.
- Club / calendar switch: `lib/lastCalendar.ts` remembers the last calendar per club in localStorage
  (`lastCalendar:<clubId>`, guarded); `pickCalendar(…, rememberedId)` prefers it (only if it exists and is not
  archived), then the account's last pair, then the first active calendar. `AppShell` exposes
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
# 1. own database on the test MySQL (port 3360, root/root)
docker compose up mysql_test -d
export DATABASE_URL="mysql://root:root@127.0.0.1:3360/club_calendar_e2e?serverVersion=8.0&charset=utf8mb4"
(cd backend && php bin/console doctrine:database:create --if-not-exists \
  && php bin/console doctrine:migrations:migrate -n && php bin/console doctrine:fixtures:load -n)
# 2. backend (own terminal in the repo root, same DATABASE_URL)
FRONTEND_URL=http://localhost:5199 MAILER_DSN=null://null php -S 127.0.0.1:3001 -t backend/public
# 3. frontend (own terminal in the repo root)
cd frontend && VITE_API_URL=http://localhost:3001 npx vite --port 5199
# 4. tests (repo root)
PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend
# afterwards: stop both servers and drop the database
mysql -h127.0.0.1 -P3360 -uroot -proot -e "DROP DATABASE club_calendar_e2e"
```

`frontend/test-results/` and `playwright-report/` are git-ignored. Key presses that open a file chooser go through
`pressForFileChooser` (`e2e/helpers.ts`; a plain `Promise.all([waitForEvent, press])` races the interception).

## Shared UI Components

Before writing raw Tailwind layout divs in a page, check `src/components/ui/shared/` first
(import from `@/components/ui/shared`):

| Component                                       | Use for                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Button` / `LinkButton` / `IconButton`          | Buttons (primary, secondary, ghost, danger, danger-solid, ghost-danger)                         |
| `SplitButton`                                   | Primary action + menu of alternatives (e.g. "Termin anlegen")                                   |
| `buttonClass()`                                 | Button styling for other elements (e.g. dialog triggers)                                        |
| `Field` + `TextInput`/`TextArea`/`NativeSelect` | Label, hint, error, aria wiring (`group` mode for composite controls)                           |
| `PasswordField`                                 | Password input with show / hide toggle                                                          |
| `Toggle`                                        | On/off switch (`role="switch"`)                                                                 |
| `Tag`                                           | Audience/property/feature labels (tones, optional emoji)                                        |
| `StatusBadge`                                   | Status as icon + word (published, draft, holiday, archived, ...)                                |
| `Banner`                                        | Persistent info/warning/danger/success notice                                                   |
| `Toaster` / `toast`                             | Short feedback (sonner, styled)                                                                 |
| `EmptyState`                                    | Empty lists with explanation and next action                                                    |
| `ConfirmDialog`                                 | Destructive confirmations incl. consequences                                                    |
| `FormDialog`                                    | Dialog with a form (title, fields, footer; Enter submits, Escape closes)                        |
| `Modal` / `ModalFrame` / `useModalInitialFocus` | Large dialog with h1, subtitle, x button (`closeLabel`), sizes, form layout; steps in one frame |
| `DialogFrame`                                   | Base dialog shell (scrim, focus trap, scroll lock, bottom sheet < 720px)                        |
| `CopyField`                                     | URLs/secrets with copy feedback                                                                 |
| `Chip` / `ChipSelect` / `FilterPillGroup`       | Toggle chips, multi-select with create, filters                                                 |
| `EmojiPicker`                                   | Club-chosen symbols (presets, custom, emoji-mart lazy)                                          |
| `Stepper`                                       | Setup progress                                                                                  |
| `LangSwitch`                                    | Language (bound to i18next)                                                                     |
| `ThemeSwitch`                                   | Hell / Dunkel / Wie System (profile, public pages)                                              |
| `Skeleton`                                      | Loading placeholders (`aria-busy` on the region)                                                |
| `ErrorSummary`                                  | Form error list with links to the fields, focus after a failed submit                           |
| `UnsavedChangesDialog`                          | "Änderungen verwerfen?" (with `useUnsavedChanges`)                                              |
| `Logo`, `Icon`                                  | Brand mark, design glyphs                                                                       |
| `SearchInput`                                   | Search field (`ap-search`) for lists and the calendar                                           |
| `FullPageLoader`                                | Page loading state (`role="status"`, `aria-busy`); also the lazy-route Suspense fallback        |

For Mapbox maps: use `useMapbox` from `src/components/locations/useMapbox.ts`.

## Build

`npm run build -w frontend` (type check + `vite build`) writes the SPA into `backend/public/` (`index.html` +
`assets/`, see `vite.config.ts`; `index.php` and `.htaccess` there stay). `backend/public/.htaccess` routes `/api/*`
to Symfony and everything else to `index.html`. Bundle check: the build prints chunk sizes; the entry chunk should
stay small (pages and dialogs are lazy, see Key conventions).
