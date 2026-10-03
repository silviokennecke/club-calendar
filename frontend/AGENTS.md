# Frontend Stack

This is a **Vite + React + React Router** SPA (not Next.js).

## Key conventions

- Routing: React Router v7 (`react-router-dom`) with `BrowserRouter`
- All routes defined in `src/App.tsx`
- Page components live in `src/pages/`, `src/pages/settings/` and `src/pages/events/`
- Protected routes wrapped in `src/components/layout/ProtectedRoute.tsx`
- No SSR, no server components, no API routes
- Environment variable: `VITE_API_URL` (not `NEXT_PUBLIC_API_URL`)
- Navigation: `useNavigate()` / `useParams()` / `useLocation()` from `react-router-dom`
- Links: `<Link to="...">` (not `href`)
- Lazy loading: `React.lazy()` + `<Suspense>` (not `next/dynamic`)

## Design system (redesign, see `docs/redesign/PLAN.md`)

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
  club picker, `headingRef` for focus). `/setup` is the onboarding (Stepper Verein/Kalender; `?clubId=` resumes
  step 2, `?new=1` forces a new club); `/clubs` is the club picker (`?select=1` skips the last-calendar redirect);
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
- Events (phase 4): own routed pages instead of the old EventModal (all in `src/App.tsx`, URL helpers in
  `components/events/routes.ts`): `…/events` list (`?status=draft&q=`), `…/events/new` choice (`?date=`),
  `…/events/new/form` form (`?date=`, `?templateId=` pre-fills from a template), `…/events/new/template` picker,
  `…/events/new/template/:templateId` single event / series preview (series creation disabled), `…/events/export`
  (client-side ICS), `…/events/:eventId` edit (read-only in archived calendars). Router state `{ from }` is the
  return target of close / save / delete (`useEventPage().returnTo`). Pure logic in `src/lib/events/` (`form.ts`
  values/validation/payload, `list.ts` tabs/search/groups, `series.ts` rule dates + holidays, `ics.ts` export,
  `format.ts`), with Vitest tests. UI in `components/events/` (`EventsTable`, `LocationSection` +
  lazy `EventLocationMap`, `StatusSeg`, `EventPageHead`, `useEventResources`, `useEventPage`).
- Import (phase 5): `…/import` is one page with a Stepper (Datei, Prüfen, Fertig; state in `pages/ImportPage.tsx`,
  UI in `components/import/`: `ImportUpload` file input + drop zone, `ImportReview` bulk panel / groups / summary bar,
  `ReviewGroup`, `ImportEditDialog`, `ImportDone`). Pure logic in `src/lib/import/` (`ics.ts` parser incl. unfolding,
  TZID/UTC, all-day end, skipped events; `review.ts` items, groups by name, place matching, bulk id diffs, duplicates,
  payload, chunks of 500) with Vitest tests. No backend dry run: the file is parsed in the browser, only the reviewed
  events are sent (new places are created first via `POST …/locations`).
- Templates (phase 5): own routed pages `…/templates` (`TemplatesPage`: cards, `?q=` search, delete dialog),
  `…/templates/new` and `…/templates/:templateId` (`TemplateEditPage`, read-only in archived calendars); pure logic in
  `src/lib/templates/` (`form.ts`). `components/events/AssignmentFields` (properties / features / target groups with
  inline creation) is shared by the event form, the template form and the import review. The old TemplateModal is gone.
- Unsaved changes: `useUnsavedChanges(dirty)` (`src/lib/useUnsavedChanges.ts`) + `<UnsavedChangesDialog>`;
  intercepts in-app link clicks and `guard(fn)` navigation, plus `beforeunload` (BrowserRouter has no `useBlocker`).
- Icons: lucide-react via `<Icon glyph="..." />` (design glyph names, `shared/Icon.tsx`). No emojis as UI icons.
- All texts via i18n (`src/locales/de.json`, `en.json`); shared component texts under `ui.*`, shell under `shell.*`.
- Tests: Vitest + Testing Library (jsdom, setup in `src/test/setup.ts`, tests run in German).

## Shared UI Components

Before writing raw Tailwind layout divs in a page, check `src/components/ui/shared/` first
(import from `@/components/ui/shared`):

| Component                                                                                | Use for                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Button` / `LinkButton` / `IconButton`                                                   | Buttons (primary, secondary, ghost, danger, danger-solid, ghost-danger) |
| `SplitButton`                                                                            | Primary action + menu of alternatives (e.g. "Termin anlegen")           |
| `buttonClass()`                                                                          | Button styling for other elements (e.g. dialog triggers)                |
| `Field` + `TextInput`/`TextArea`/`NativeSelect`                                          | Label, hint, error, aria wiring (`group` mode for composite controls)   |
| `Toggle`                                                                                 | On/off switch (`role="switch"`)                                         |
| `Tag` / `TagBadge` / `TagBadgeRow`                                                       | Audience/property/feature labels (tones)                                |
| `StatusBadge`                                                                            | Status as icon + word (published, draft, holiday, archived, ...)        |
| `Banner`                                                                                 | Persistent info/warning/danger/success notice                           |
| `Toaster` / `toast`                                                                      | Short feedback (sonner, styled)                                         |
| `EmptyState`                                                                             | Empty lists with explanation and next action                            |
| `ConfirmDialog`                                                                          | Destructive confirmations incl. consequences                            |
| `CopyField`                                                                              | URLs/secrets with copy feedback                                         |
| `Chip` / `ChipSelect` / `FilterPillGroup`                                                | Toggle chips, multi-select with create, filters                         |
| `EmojiPicker`                                                                            | Club-chosen symbols (presets, custom, emoji-mart lazy)                  |
| `Stepper`                                                                                | Setup progress                                                          |
| `LangSwitch`                                                                             | Language (bound to i18next)                                             |
| `Skeleton`                                                                               | Loading placeholders (`aria-busy` on the region)                        |
| `ErrorSummary`                                                                           | Form error list with links to the fields, focus after a failed submit   |
| `UnsavedChangesDialog`                                                                   | "Änderungen verwerfen?" (with `useUnsavedChanges`)                      |
| `Logo`, `Icon`                                                                           | Brand mark, design glyphs                                               |
| `SectionHeader`, `ListCard`, `ListRow`, `SearchInput`, `FullPageLoader`, `FullPageError` | Legacy helpers, restyled with tokens                                    |

For Mapbox maps: use `useMapbox` from `src/components/locations/useMapbox.ts`.

## Build

`npm run build` outputs static files to `dist/`. Serve with any webserver.
For SPA routing, the webserver must redirect all 404s to `index.html`.
