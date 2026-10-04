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
5. Aufräumen: Server auf 3001 / 5199 beenden, `DROP DATABASE club_calendar_e2e`.
