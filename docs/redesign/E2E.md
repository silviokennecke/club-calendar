# E2E-Umgebung (isoliert)

Die Playwright-Suite legt Nutzer an und schreibt Daten. Sie darf nie gegen die Dev-API / Dev-DB laufen
(`frontend/.env.local` zeigt auf `https://api.club-calendar.test`). `frontend/e2e/global-setup.ts` bricht ab, wenn
`PLAYWRIGHT_BASE_URL`, `E2E_API_URL`, `VITE_API_URL` oder die `VITE_API_URL` des laufenden Vite-Servers nicht auf
localhost zeigt.

1. Eigene DB auf dem Test-MySQL: `docker compose up mysql_test -d`, dann mit
   `DATABASE_URL=mysql://root:root@127.0.0.1:3360/club_calendar_e2e?serverVersion=8.0&charset=utf8mb4`
   in `backend/`: `php bin/console doctrine:database:create --if-not-exists`, `doctrine:migrations:migrate -n`,
   `APP_ENV=dev php bin/console doctrine:fixtures:load -n` (das Fixtures-Bundle gibt es nur in dev/test; `.env` setzt
   `APP_ENV=prod`).
2. Backend: `FRONTEND_URL=http://localhost:5199 MAILER_DSN=null://null php -S 127.0.0.1:3001 -t backend/public`
   (gleiche `DATABASE_URL` in der Umgebung; `BACKEND_URL` aus `.env` ist schon `http://localhost:3001`, sonst setzen:
   Links der neuen E-Mail-Adresse und der SSO-Verknüpfung bauen darauf auf).
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

Xdebug: Läuft PhpStorm (oder eine andere IDE) mit Debug-Listener auf Port 9003, warten PHP-Prozesse dort auf den
Debugger und hängen. Dann `XDEBUG_MODE=off` setzen, für den PHP-Server (Schritt 2), für Konsolenbefehle (Schritt 1)
und für Playwright (Schritt 4). `e2e/helpers.ts` ruft Konsolenbefehle des Backends auf (`backendConsole`: `php
bin/console` in `backend/` mit `DATABASE_URL` der E2E-Datenbank, überschreibbar mit `E2E_DATABASE_URL`;
`XDEBUG_MODE=off`, wenn nicht gesetzt): `app:user:verify <email>` bestätigt neu registrierte Nutzer (der E2E-Server
verschickt keine Mails), `app:user:reset-link <email>` liefert Reset-Links (`account.spec.ts`; `session-revoked.spec.ts`
beendet Sitzungen über einen echten Reset). Der Konsolenbefehl läuft mit `APP_ENV` aus `.env` (prod) und teilt sich den
Cache `backend/var/cache/prod` mit dem PHP-Server.

Aufräumen (immer, auch nach Fehlern): Server auf 3001 / 5199 beenden, `DROP DATABASE club_calendar_e2e`,
`frontend/test-results` und `backend/var/cache/prod` löschen (der Rate-Limiter von "Passwort vergessen" merkt sich
dort 20 Anfragen je IP und Stunde).
