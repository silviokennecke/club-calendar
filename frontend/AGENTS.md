# Frontend Stack

This is a **Vite + React + React Router** SPA (not Next.js).

## Key conventions

- Routing: React Router v7 (`react-router-dom`) with `BrowserRouter`
- All routes defined in `src/App.tsx`
- Page components live in `src/pages/` and `src/pages/settings/`
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
- Icons: lucide-react via `<Icon glyph="..." />` (design glyph names, `shared/Icon.tsx`). No emojis as UI icons.
- All texts via i18n (`src/locales/de.json`, `en.json`); shared component texts under `ui.*`, shell under `shell.*`.
- Tests: Vitest + Testing Library (jsdom, setup in `src/test/setup.ts`, tests run in German).

## Shared UI Components

Before writing raw Tailwind layout divs in a page, check `src/components/ui/shared/` first
(import from `@/components/ui/shared`):

| Component                                                                                | Use for                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Button` / `LinkButton` / `IconButton`                                                   | Buttons (primary, secondary, ghost, danger, danger-solid, ghost-danger) |
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
| `Logo`, `Icon`                                                                           | Brand mark, design glyphs                                               |
| `SectionHeader`, `ListCard`, `ListRow`, `SearchInput`, `FullPageLoader`, `FullPageError` | Legacy helpers, restyled with tokens                                    |

For Mapbox maps: use `useMapbox` from `src/components/locations/useMapbox.ts`.

## Build

`npm run build` outputs static files to `dist/`. Serve with any webserver.
For SPA routing, the webserver must redirect all 404s to `index.html`.
