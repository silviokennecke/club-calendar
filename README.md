# Club Calendar

A web app for clubs to manage and publish event calendars.

A **Club** has one or more **Calendars** containing events, event templates, locations, and reference data (properties, features, target groups). Calendars can be published as **feeds** (ICS + web), either public or protected by a shared secret. Users sign in with email/password, Google/Microsoft SSO, or WebAuthn passkeys; email addresses are verified via double opt-in.

## Tech Stack

- **Backend:** PHP 8.4, Symfony 8.1, Doctrine ORM + Migrations, JWT auth (`lexik/jwt-authentication-bundle`), MySQL 8
- **Frontend:** Vite, React 19, React Router 7, TypeScript, Tailwind CSS, shadcn/ui, FullCalendar
- **Tests:** PHPUnit (backend), Vitest (frontend unit), Playwright (E2E)

## Repository Layout

- `backend/` — Symfony API server (port 3001)
- `frontend/` — Vite/React single-page app (port 5173)
- `docker-compose.yml` — optional MySQL dev/test databases (any MySQL 8 instance works)

## Development Setup

### Prerequisites

- PHP 8.4 with Composer
- [Symfony CLI](https://symfony.com/download)
- Node.js 22 (see `.nvmrc`) and npm
- MySQL 8 — either your own instance or the optional `docker-compose.yml` (Docker is not required by any npm/composer script)

### 1. Provide the databases

Use any MySQL 8 server and set `DATABASE_URL` / `TEST_DATABASE_URL` in `backend/.env.local` (defaults: dev on port `3306`, tests on `3360`). With Docker, you can start both with:

```bash
docker compose up mysql mysql_test -d
```

### 2. Backend

```bash
# from the repository root
npm install                  # frontend + mail tooling
npm run build:dev            # composer install + mail templates + frontend dev build
cp backend/.env.example backend/.env.local   # then adjust values if needed
```

Generate the JWT keypair (the passphrase defaults to `APP_SECRET`):

```bash
(cd backend && php bin/console lexik:jwt:generate-keypair)
```

Run migrations and, optionally, load seed data:

```bash
npm run migrate
npm run fixtures   # optional
```

Start the API server on port 3001:

```bash
(cd backend && symfony serve --port=3001 -d)
```

### 3. Frontend

```bash
cp frontend/.env.local.example frontend/.env.local   # VITE_API_URL=http://localhost:3001
npm run dev:frontend
```

The app is available at <http://localhost:5173>.

### Email templates

The verification email is written in MJML. After editing `backend/templates/email/verify_email.mjml`, regenerate the Twig template:

```bash
npm run build:mail -w backend
```

## Scripts

Run from the repository root:

| Command                                  | Purpose                                                                          |
|------------------------------------------|----------------------------------------------------------------------------------|
| `npm run build:dev`                      | Dev build: `composer install`, mail templates, frontend dev build                |
| `npm run build`                          | Production build: `composer install --no-dev -o`, mail templates, frontend build |
| `npm run dev:frontend`                   | Start the Vite dev server                                                        |
| `npm test`                               | Backend (PHPUnit) then frontend (Vitest) tests                                   |
| `npm run test:backend` / `test:frontend` | Run one side only (backend needs the MySQL test DB)                              |
| `npm run migrate` / `npm run fixtures`   | Run Doctrine migrations / load fixtures                                          |

Per workspace (`-w backend` or `-w frontend`): backend has `build`, `build:dev`, `build:mail`, `test`, `migrate`, `fixtures`; frontend has `dev`, `build`, `build:dev`, `test`, `test:watch`, `lint`, `e2e`.

## Tests

```bash
npm test                # backend (PHPUnit) then frontend (Vitest)
npm run test:backend    # requires the MySQL test DB (TEST_DATABASE_URL)
npm run test:frontend
npm run test:watch -w frontend
```

E2E tests (Playwright) need the backend and frontend dev servers running:

```bash
npm run e2e -w frontend
npm run e2e:ui -w frontend   # interactive mode
```

## ICS Feed

```
GET /api/feed/:feedId/ics
GET /api/feed/:feedId/ics?secret=<token>   # private feeds
```

## Further Reading

See `CLAUDE.md` / `AGENTS.md` for architecture notes and project conventions.
