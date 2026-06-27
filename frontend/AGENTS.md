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

## Shared UI Components

Before writing raw Tailwind layout divs in a page, check `src/components/ui/shared/` first:

| Component | Replaces |
|---|---|
| `FormField` | `<div className="space-y-1.5"><Label>…</Label>…</div>` |
| `SectionHeader` | `<div className="flex items-center justify-between mb-6">…</div>` |
| `EmptyState` | `<div className="text-center py-12 … border-dashed …">…</div>` |
| `ListCard` | `<div className="bg-white rounded-xl border … divide-y …">…</div>` |
| `ListRow` | `<div className="flex items-center justify-between px-4 py-3">…</div>` |
| `TagBadge` / `TagBadgeRow` | Inline colored `<span className="text-xs bg-… rounded-full">` pills |
| `FilterPillGroup` | Toggle pill buttons for filtering |
| `DangerZoneConfirm` | Two-step destructive action UI |
| `SearchInput` | Icon-prefixed input with clear button |
| `FullPageLoader` / `FullPageError` | `<div className="flex … min-h-screen bg-slate-50">…</div>` |
| `Alert` | Colored `bg-{color}-50 border-{color}-200` alert boxes |

Import: `import { FormField, SectionHeader, ... } from '@/components/ui/shared'`

For Mapbox maps: use `useMapbox` from `src/components/locations/useMapbox.ts`.

## Build

`npm run build` outputs static files to `dist/`. Serve with any webserver.
For SPA routing, the webserver must redirect all 404s to `index.html`.
