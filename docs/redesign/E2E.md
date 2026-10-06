# E2E-Umgebung (isoliert)

Die Playwright-Suite legt Nutzer an und schreibt Daten. Sie darf nie gegen die Dev-API / Dev-DB laufen
(`frontend/.env.local` zeigt auf `https://api.club-calendar.test`). `frontend/e2e/global-setup.ts` bricht ab, wenn
`PLAYWRIGHT_BASE_URL`, `E2E_API_URL`, `VITE_API_URL` oder die `VITE_API_URL` des laufenden Vite-Servers nicht auf
localhost zeigt.

1. Eigene DB auf dem Test-MySQL: `docker compose up mysql_test -d`, dann mit
   `DATABASE_URL=mysql://root:root@127.0.0.1:3360/club_calendar_e2e?serverVersion=8.0&charset=utf8mb4`
   in `backend/`: `php bin/console doctrine:database:create --if-not-exists`, `doctrine:migrations:migrate -n`,
   `doctrine:fixtures:load -n`.
2. Backend: `FRONTEND_URL=http://localhost:5199 MAILER_DSN=null://null php -S 127.0.0.1:3001 -t backend/public`
   (gleiche `DATABASE_URL` in der Umgebung).
3. Frontend: `cd frontend && VITE_API_URL=http://localhost:3001 npx vite --port 5199`.
4. Tests: `PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend`.
5. Fehlerseite im Produktions-Build (optional): `e2e/error-page.spec.ts` prüft gegen den Dev-Server die 404-Seite und
   einen blockierten Seiten-Import (im Dev-Modus gibt es kein `vite:preloadError`, also keinen automatischen Reload).
   Den Reload-Schutz (genau ein Reload, dann Fehlerseite) testet ein Test, der nur mit `E2E_PREVIEW_URL` läuft:
   `VITE_API_URL=http://localhost:3001 npx vite build --outDir /tmp/e2e-dist` (in `frontend/`),
   `npx vite preview --outDir /tmp/e2e-dist --port 5198`, dann
   `E2E_PREVIEW_URL=http://localhost:5198 PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend -- error-page`.
   Ohne `E2E_PREVIEW_URL` wird dieser Test übersprungen.
6. Aufräumen: Server auf 3001 / 5199 beenden, `DROP DATABASE club_calendar_e2e`.
