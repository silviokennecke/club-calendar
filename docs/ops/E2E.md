# E2E-Umgebung (isoliert)

Die Playwright-Suite legt Nutzer an und schreibt Daten. Sie darf nie gegen die Dev-API / Dev-DB laufen
(`frontend/.env.local` zeigt auf die Dev-API). `frontend/e2e/global-setup.ts` bricht ab, wenn
`PLAYWRIGHT_BASE_URL`, `E2E_API_URL`, `VITE_API_URL` oder die `VITE_API_URL` des laufenden Vite-Servers nicht auf
localhost zeigt.

Es gibt keinen `mysql_test`-Dienst in `docker-compose.yml` (mehr). `backend/.env.local` kann `TEST_DATABASE_URL` auf
die lokale Dev-MySQL legen; für E2E- und automatisierte PHPUnit-Läufe (Agenten, CI) stattdessen einen
**Wegwerf-MySQL-Container** nutzen und die Dev-Datenbanken nie anfassen (die Tests leeren alle Tabellen, neue
Migrationen gehören nicht ungeprüft auf die Dev-DB).

1. Wegwerf-Container starten und warten, bis er antwortet:
   ```bash
   docker run -d --name cc-verify-mysql -p 3360:3306 -e MYSQL_ROOT_PASSWORD=root \
     -e MYSQL_DATABASE=club_calendar_test mysql:8.0.36
   until mysql -h127.0.0.1 -P3360 -uroot -proot -e 'SELECT 1' >/dev/null 2>&1; do sleep 2; done
   ```
   PHPUnit gegen diesen Container (die Shell-Variable überschreibt `backend/.env.local`):
   ```bash
   export TEST_DATABASE_URL="mysql://root:root@127.0.0.1:3360/club_calendar_test?serverVersion=8.0&charset=utf8mb4"
   (cd backend && APP_ENV=test php bin/console doctrine:migrations:migrate -n && composer test)
   ```
2. E2E-Datenbank im selben Container: mit
   `DATABASE_URL=mysql://root:root@127.0.0.1:3360/club_calendar_e2e?serverVersion=8.0&charset=utf8mb4`
   in `backend/`: `php bin/console doctrine:database:create --if-not-exists`, `doctrine:migrations:migrate -n`,
   `APP_ENV=dev php bin/console doctrine:fixtures:load -n` (das Fixtures-Bundle gibt es nur in dev/test).
3. Backend (Repo-Wurzel, gleiche `DATABASE_URL`), mit hohen IP-Limits: in `dev`/`prod` gelten 5 Registrierungen/h, 10 Logins/15 min
   und 60 Token-Erneuerungen/min je IP, die Suite läuft sonst nach wenigen Tests in 429 `rate_limited`
   (`AUTH_LOGIN_IP_LIMIT`, `AUTH_REGISTER_IP_LIMIT`, `AUTH_REFRESH_IP_LIMIT`, `AUTH_IDENTIFY_IP_LIMIT`, `AUTH_IDENTIFY_EMAIL_LIMIT`). Die Umgebung `test` taugt nicht: dort
   speichert der Hasher Passwörter im Klartext, die Fixture-Anmeldung `admin@example.com` schlüge fehl:
   `AUTH_LOGIN_IP_LIMIT=100000 AUTH_REGISTER_IP_LIMIT=100000 AUTH_REFRESH_IP_LIMIT=100000 AUTH_IDENTIFY_IP_LIMIT=100000 AUTH_IDENTIFY_EMAIL_LIMIT=100000 MCP_ALLOWED_CLIENTS='*' WEBAUTHN_RP_ID=localhost FRONTEND_URL=http://localhost:5199 BACKEND_URL=http://localhost:3001 MAILER_DSN=null://null php -S 127.0.0.1:3001 -t backend/public`.
   `WEBAUTHN_RP_ID=localhost` ist nötig, wenn `backend/.env.local` eine andere `APP_URL` setzt (der Standard ist deren Host), sonst scheitern die Passkey-Tests in `profile.spec.ts`.
   `FRONTEND_URL`/`BACKEND_URL` stehen nicht mehr in `.env` (sie folgen `APP_URL`, siehe `config/services.yaml`) und
   müssen hier gesetzt werden: Passkey-Origin, Links der neuen E-Mail-Adresse und der SSO-Verknüpfung bauen darauf
   auf (für PHPUnit setzt sie `phpunit.dist.xml`).
4. Frontend: `cd frontend && VITE_API_URL=http://localhost:3001 npx vite --port 5199 --strictPort`.
5. Tests: `PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend`.
6. Fehlerseite im Produktions-Build (optional): `e2e/error-page.spec.ts` prüft gegen den Dev-Server die 404-Seite und
   einen blockierten Seiten-Import (im Dev-Modus gibt es kein `vite:preloadError`, also keinen automatischen Reload).
   Den Reload-Schutz (genau ein Reload, dann Fehlerseite) testet ein Test, der nur mit `E2E_PREVIEW_URL` läuft:
   `VITE_API_URL=http://localhost:3001 npx vite build --outDir /tmp/e2e-dist` (in `frontend/`),
   `npx vite preview --outDir /tmp/e2e-dist --port 5198`, dann
   `E2E_PREVIEW_URL=http://localhost:5198 PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend -- error-page`.
   Ohne `E2E_PREVIEW_URL` wird dieser Test übersprungen.
7. CSP-Regression (optional): `e2e/csp.spec.ts` setzt die Policy aus `docker/Caddyfile` auf jede Dokumentantwort und
   schlägt bei jedem `securitypolicyviolation` fehl. Es braucht einen Produktions-Build statt des Vite-Dev-Servers
   (der Dev-Server injiziert Styles); Port 5199 muss frei sein (Dev-Server vorher beenden), damit `FRONTEND_URL` (CORS) passt:
   `VITE_API_URL=http://localhost:3001 npx vite build --outDir /tmp/e2e-dist` und
   `npx vite preview --outDir /tmp/e2e-dist --port 5199 --strictPort` (in `frontend/`), dann
   `E2E_CSP=1 PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend -- csp`. Nicht prüfbar ohne `MAPBOX_TOKEN`: die echte Mapbox-Karte (ohne Token zeigen die Seiten nur den Fehlerzustand).

`MCP_ALLOWED_CLIENTS='*'` erlaubt für `e2e/mcp-consent.spec.ts` jeden OAuth-Client, auch die Loopback-Weiterleitung `http://127.0.0.1/callback`; ohne die Variable gilt die Standardliste (claude, openai, gemini) und mit leerem Wert ist kein Client erlaubt; beides lässt die Registrierung mit 400 `invalid_redirect_uri` fehlschlagen. Liegt auf Port 3001 schon ein anderer Server, den E2E-Backend-Port wechseln (`php -S 127.0.0.1:3011`, `BACKEND_URL`, `VITE_API_URL` und `E2E_API_URL=http://localhost:3011` anpassen).

Xdebug: Läuft PhpStorm (oder eine andere IDE) mit Debug-Listener auf Port 9003, warten PHP-Prozesse dort auf den
Debugger und hängen. Dann `XDEBUG_MODE=off` setzen, für den PHP-Server (Schritt 3), für Konsolenbefehle (Schritte 1–2)
und für Playwright (Schritt 5). `e2e/helpers.ts` ruft Konsolenbefehle des Backends auf (`backendConsole`: `php
bin/console` in `backend/` mit `DATABASE_URL` der E2E-Datenbank, überschreibbar mit `E2E_DATABASE_URL`;
`XDEBUG_MODE=off`, wenn nicht gesetzt): `app:user:verify` / `app:user:activate` (`<id|email>` bestätigt Adressen und entfernt ausstehende Bestätigungscodes), `app:user:reset-link <email>` liefert Reset-Links (`account.spec.ts`; `session-revoked.spec.ts`
beendet Sitzungen über einen echten Reset), `app:user:create` und `app:user:set-password` (Nutzer anlegen/Passwörter ändern). Der Konsolenbefehl läuft mit `APP_ENV` aus `.env` (prod) und teilt sich den
Cache `backend/var/cache/prod` mit dem PHP-Server.

Die Docs-Screenshot-Specs `organize.docs.ts` und `publishing.docs.ts` befüllen Daten über `docker exec cc-verify-mysql … club_calendar_e2e` (Datenbankname fest eingetragen, `E2E_DATABASE_URL` gilt dort nicht): Container und Datenbank `club_calendar_e2e` müssen so heißen, sonst schlagen diese 8 Specs fehl.

Virtueller Authenticator (CDP `WebAuthn`, `automaticPresenceSimulation: true`): Die Anmeldeseite stellt im Hintergrund eine stille Passkey-Anfrage (Autofill), die ein solcher Authenticator sofort beantwortet und damit den Login auslöst. In Tests, die nur Passkeys registrieren oder selbst auslösen, vorher `setPresenceSimulation(cdp, authenticatorId, false)` (`e2e/helpers.ts`) aufrufen und erst für den gewollten Schritt wieder einschalten.

Aufräumen (immer, auch nach Fehlern): Server auf 3001 / 5199 beenden (auch den `npm exec`-Elternprozess von Vite),
`DROP DATABASE club_calendar_e2e`, Container entfernen (`docker rm -f cc-verify-mysql`), `frontend/test-results` und
`backend/var/cache/prod` löschen (der Rate-Limiter von "Passwort vergessen" merkt sich dort 20 Anfragen je IP und
Stunde).
