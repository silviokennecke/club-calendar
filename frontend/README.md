# Frontend

Vite + React 19 + React Router single-page app of Club Calendar (not Next.js). The build is written into
`backend/public/` and served by the backend.

```bash
npm run dev:frontend          # from the repo root: Vite dev server on http://localhost:5173
npm run build -w frontend     # type check + production build
npm test -w frontend          # Vitest
npm run lint -w frontend      # ESLint (0 warnings) + Prettier check
```

Copy `.env.local.example` to `.env.local` (`VITE_API_URL`, the backend URL). Conventions, design system and the
isolated E2E setup: [`AGENTS.md`](AGENTS.md) and `../docs/ops/E2E.md`.
