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
- `docker-compose.yml` — MySQL dev and test databases

## Development Setup

### Prerequisites

- PHP 8.4 with Composer
- [Symfony CLI](https://symfony.com/download)
- Node.js 22 (see `.nvmrc`) and npm
- Docker (for MySQL and the optional Mailpit mail catcher)

### 1. Start the databases

```bash
npm run db:up   # = docker compose up mysql mysql_test -d
```

This starts MySQL on port `3306` (dev) and `3360` (tests).

### 2. Backend

```bash
cd backend
composer install
cp .env.example .env.local   # then adjust values if needed
```

Generate the JWT keypair (the passphrase defaults to `APP_SECRET`):

```bash
php bin/console lexik:jwt:generate-keypair
```

Run migrations and, optionally, load seed data:

```bash
php bin/console doctrine:migrations:migrate
php bin/console doctrine:fixtures:load   # optional
```

Start the API server on port 3001:

```bash
symfony serve --port=3001 -d
```

### 3. Frontend

From the repository root:

```bash
npm install
cp frontend/.env.local.example frontend/.env.local   # VITE_API_URL=http://localhost:3001
npm run dev:frontend
```

The app is available at <http://localhost:5173>.

### Email templates

The verification email is written in MJML. After editing `backend/templates/email/verify_email.mjml`, regenerate the Twig template:

```bash
npm run mjml
```

## Tests

```bash
npm test                # backend (PHPUnit) then frontend (Vitest)
npm run test:backend    # requires the MySQL test DB on port 3360
npm run test:frontend
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
