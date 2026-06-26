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

## Build

`npm run build` outputs static files to `dist/`. Serve with any webserver.
For SPA routing, the webserver must redirect all 404s to `index.html`.
