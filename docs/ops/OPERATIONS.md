# Betrieb

- **Migrationen** auf Dev und Prod ausführen (`npm run migrate`; Deploy und Container-Entrypoint machen es
  automatisch): `Version20261004120000` (`auth_nonce`), `Version20261004130000` (`user.token_version`),
  `Version20261009120000` (Vorlagen-Zeiten nullable), `Version20261010120000` (`event.external_uid`),
  `Version20261013120000` (`password_reset`, `email_change`, `passkey.last_used_at`, `club_user.last_calendar_id`),
  `Version20261014120000` (`event_series`, `event.series_id`), `Version20261015120000` (Feed-Status: `PUBLIC` →
  `CLUB`, `PRIVATE` bleibt, `calendar_feed.searchable`), `Version20261019120000` (Club roles: `club_user.role` mit Enum viewer|editor|admin, alle bestehenden Mitglieder werden admin, Einladungen tragen eine `role` mit default editor), `Version20261020120000` (Club-Scoping: `calendar_feed` + `calendar_feed_calendar` (join-Tabelle für N:M), `location` + `target_group` auf Club-Ebene statt Calendar; bestehende Feeds auf den einen Kalender begrenzt, keine Zusammenfassung; Backup empfohlen, auf Testumgebung ausprobieren). Nach der Feed-Status-Migration sind bisher öffentliche Feeds
  nur per Link (nicht indexiert); wer einen Feed in Suchmaschinen haben will, stellt ihn auf "Öffentlich" und
  schaltet "Für Suchmaschinen auffindbar" ein.
- **Umgebungsvariablen (Produktion):** `APP_SECRET` (signiert Passkey-Challenges, OAuth-State und SSO-Tickets; ein
  Wechsel macht laufende Anmeldevorgänge ungültig) und `JWT_REFRESH_SECRET` müssen gesetzt sein (Platzhalter in
  `.env`). `APP_URL` = öffentliche Adresse; `FRONTEND_URL`, `BACKEND_URL` und `WEBAUTHN_RP_ID` leiten sich daraus ab
  (`config/services.yaml`) und werden nur bei getrennten Hosts gesetzt (für Tests setzt sie `phpunit.dist.xml`).
  `BACKEND_URL` muss die öffentliche API-Adresse sein (Link der neuen E-Mail-Adresse, SSO-Link-Start).
  `WEBAUTHN_RP_NAME`, optional `WEBAUTHN_USER_VERIFICATION` (`preferred`/`required`); erlaubte Passkey-Origin ist
  `FRONTEND_URL` (exakt).
- **Cron:** `php bin/console app:prune-unverified-users` und `php bin/console app:prune-password-resets` (z. B.
  täglich; abgelaufene Reset-Links und E-Mail-Wechsel) sowie `php bin/console app:prune-refresh-tokens` (beendete
  Refresh-Token-Sitzungen; Lebensdauer `REFRESH_TOKEN_ABSOLUTE_LIFETIME`, Wiederholungsfenster `REFRESH_TOKEN_REUSE_GRACE`) und `php bin/console app:prune-oauth` (abgelaufene OAuth-/MCP-Anfragen, Codes, Tokens, beendete
  Grants, ungenutzte Clients).
- **SSO (ID-Token-Signatur):** Das Backend ruft die öffentlichen Schlüssel (JWKS) der aktivierten Anbieter per HTTPS ab: `www.googleapis.com` (Google), `login.microsoftonline.com` (Microsoft), `appleid.apple.com` (Apple), zusätzlich deren OIDC-Discovery-Hosts (`accounts.google.com`, `login.microsoftonline.com`, `appleid.apple.com`). Sind sie nicht erreichbar und die Schlüssel nicht im Cache (1 Stunde), schlägt die SSO-Anmeldung mit `oauth_failed` fehl.
- **Feiertage (OpenHolidays):** vordefinierte Feiertags-/Ferienkalender lädt das Backend von `openholidaysapi.org` (ausgehend HTTPS, der Host muss erreichbar sein; Auswahllisten 7 Tage gecacht). Die Daten liegen in der DB; veraltete (> 3 Monate) Kalender aktualisiert die App beim Lesen, zusätzlich Cron `php bin/console app:holidays:refresh --all` (optional `--calendar=<id>`, z. B. wöchentlich). Fällt die Quelle aus, bleiben die gespeicherten Daten erhalten. ICS-Adressen eigener Feiertagskalender folgen höchstens 3 Weiterleitungen (jedes Ziel wird gegen private Netze geprüft); Anlegen per URL und manuelles Aktualisieren sind auf 20 pro Nutzer und Stunde begrenzt (Cron und automatisches Aktualisieren nicht).
- **Verzeichnislisten (Audit I2):** `.htaccess` setzt bewusst kein `Options -Indexes -MultiViews` (ein `Options` ohne `AllowOverride Options` ist ein 500 für die ganze Seite, `<IfModule>` schützt nicht davor). Mit `mod_rewrite` landen Verzeichnis-URLs (`/assets/`) beim SPA, ohne `mod_rewrite` antwortet `.htaccess` mit 403; Caddy hat kein `browse`. Eigene Server (nginx): `autoindex off` (Standard). Sourcemaps werden nicht gebaut (`build.sourcemap: false`), `*.map` ist zusätzlich gesperrt.
- **MCP / OAuth:** `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` (und `…/api/mcp`) sowie `/api/mcp` müssen zu PHP geroutet werden (`.htaccess`, `docker/Caddyfile` tun das; nginx: eigene `location`-Blöcke auf `index.php`, `/.well-known` nicht per Dotfile-Regel sperren, für `/api/mcp` `fastcgi_buffering off`). Hinter einem Proxy `/api/mcp` nicht puffern und lange Verbindungen (SSE) erlauben. Env: `MCP_ACCESS_TOKEN_TTL`, `MCP_REFRESH_TOKEN_LIFETIME`, `MCP_REFRESH_TOKEN_ABSOLUTE_LIFETIME`, `MCP_REFRESH_TOKEN_REUSE_GRACE`, `MCP_ALLOWED_CLIENTS` (`backend/.env.example`; Standard `claude,openai,gemini`; `*` allein = alle Clients, leer = keiner; ein früher leerer Wert muss auf `*` gesetzt werden, sonst können sich Clients nicht mehr verbinden). Migration `Version20261025120000` (OAuth-/MCP-Tabellen) und `Version20261026120000`. Cron `app:prune-oauth` (täglich). Nutzer sehen und widerrufen Verbindungen im Profil; Passwortänderung und "Überall abmelden" beenden alle MCP-Zugänge. Browser-Clients auf fremder Origin scheitern an CORS (nur `FRONTEND_URL`).
- **OPAQUE-Schlüssel (Vorbereitung, Flag standardmäßig aus):** `OPAQUE_ENABLED` (Standard `false`), `OPAQUE_OPRF_SEED` (64 Byte) und `OPAQUE_SERVER_PRIVATE_KEY` (32 Byte, kanonischer ristretto255-Skalar), beide als Base64url ohne Padding. Erzeugen mit `php bin/console app:opaque:generate-keys` (gibt nur auf stdout aus, speichert nichts; im Container `docker exec <container> php bin/console app:opaque:generate-keys`). Die Werte dauerhaft als Secret ablegen und **sichern**: Der Entrypoint erzeugt sie bewusst nicht automatisch, und gehen Seed oder Schlüssel verloren (oder werden sie ersetzt), sind alle OPAQUE-Passwort-Records wertlos und jedes betroffene Konto muss sein Passwort zurücksetzen. Bei `OPAQUE_ENABLED=true` und fehlenden oder ungültigen Werten bricht der Start des Dienstes mit einer klaren Fehlermeldung ab; bei `false` werden sie nicht gelesen. `ext-sodium` ist Pflicht (das Docker-Image prüft es im Build).
- **Mail-Templates:** nach Änderungen an `templates/email/*.mjml` `npm run build:mail -w backend` (die kompilierten
  `*.html.twig` sind eingecheckt; `npm run build` baut sie ebenfalls). Dazu `password_changed`,
  `email_change_requested`, `email_changed` (Hinweis-Mails ohne Links außer `/forgot-password`).
- **Reverse Proxy:** der IP-Limiter von "Passwort vergessen" nutzt `Request::getClientIp()`; hinter einem Proxy, der
  die Client-Adresse nicht als `REMOTE_ADDR` weitergibt, `framework.trusted_proxies` setzen (sonst teilen sich alle
  Nutzer einen Zähler).
- **Rechtstexte:** `imprint.md`, `privacy.md`, `terms.md` (siehe `backend/legal/README.md`) in ein Verzeichnis legen und es im Container nach `/var/www/html/legal` mounten (oder `LEGAL_DOCUMENTS_PATH` setzen); `app:legal:sync` läuft beim Start und bei Cache-Warmup, fehlende Dokumente erscheinen als Warnung im Log. Neue Datei-Inhalte erzeugen eine neue Version und fordern erneute Zustimmung.
- **Support:** `app:user:create` (Nutzer mit verifizierten Adressen anlegen, für den ersten Admin bei `RESTRICT_REGISTRATION=true`), `app:user:set-password` (setzt ein neues Passwort, beendet alle Sitzungen, löscht Passwort-Reset-Links und wartende E-Mail-Wechsel), `app:user:verify` / `app:user:activate` (`<id|email>` bestätigt eine Adresse und entfernt ausstehende Bestätigungscodes), `app:user:reset-link <email>` gibt einen Reset-Link aus (60 Minuten gültig, gewährt Zugang zum Konto: nur an den Eigentümer).
- **HTTPS für SSO:** das State-Cookie ist `Secure; SameSite=None`; lokal Chrome/Firefox oder HTTPS (Safari nicht
  zuverlässig).
- **PHP-Limits:** Import von 5000 Terminen braucht rund 130 MB zusätzlich (`memory_limit`, Container 256M) und
  2–3 MB Body (`post_max_size` großzügig, Container 16M); `display_errors` aus.
- **Webserver:** nichts mehr manuell nötig: `Referrer-Policy: no-referrer` für `/feed/*` und `/api/feed/*` steht in
  `backend/public/.htaccess` (Apache, braucht `mod_headers`) und `docker/Caddyfile`. Wer nginx nutzt, ergänzt im
  `server`-Block (`always` gilt auch für Fehlerantworten):
  ```nginx
  location ~ ^/(api/)?feed/ {
      add_header Referrer-Policy "no-referrer" always;
      # ... gleiche try_files/fastcgi-Regeln wie der allgemeine location-Block (add_header wird in
      # verschachtelten Blöcken nicht geerbt: die allgemeinen Header dort wiederholen)
  }
  ```
  `X-Robots-Tag` setzt das Backend (nur Feed-API, je Feed: noindex außer öffentlich + auffindbar), nicht der Webserver.
- **Security-Header (Audit M4):** `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy` und das Standard-`Referrer-Policy` (`strict-origin-when-cross-origin`)
  stehen in `backend/public/.htaccess` und `docker/Caddyfile` (identisch, geprüft von `SecurityHeadersConfigTest`).
  `Strict-Transport-Security` setzt `.htaccess` nur bei HTTPS (auch `X-Forwarded-Proto: https`); der Caddy-Container
  läuft hinter einem TLS-Terminator und setzt es nicht: **dort `Strict-Transport-Security: max-age=31536000` ergänzen** (Betreiberaufgabe, so entschieden; siehe `BACKLOG.md`)
  (erst `includeSubDomains`/`preload`, wenn alle Subdomains HTTPS können). Getrennte Hosts (`VITE_API_URL` auf anderer
  Origin): API-Origin in `connect-src` und `img-src` (statische Kartenbilder `/api/map/image/*`) der CSP aufnehmen. nginx, im `server`-Block (nicht vergessen: `add_header` wird in
  verschachtelten `location`-Blöcken nicht geerbt, also auch im Feed-Block wiederholen, dort mit `no-referrer`):
  ```nginx
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'sha256-+A14ONesVdzkn6nr37Osn+rUqNz4oFGZFDbLXrlae04='; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; child-src blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()" always;
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Strict-Transport-Security "max-age=31536000" always;
  location ~ /\.(?!well-known)|\.(env|pem|log)$ { deny all; }
  ```
  `style-src` kennt kein `'unsafe-inline'`: React setzt `style=` über das CSSOM (nicht blockiert), sonner liefert sein CSS als Datei,
  nur das feste Stylesheet des emoji-mart-Pickers (Shadow DOM) ist per Hash erlaubt (`sha256-+A14ONesVdzkn6nr37Osn+rUqNz4oFGZFDbLXrlae04=`, Drift-Test in
  `frontend/src/lib/__tests__/cspStyleHash.test.ts`). Ein eigener nginx-Header muss denselben Hash tragen.
- **Nach einem Deploy** fehlen die Chunks des vorigen Releases; das Frontend lädt bei einem fehlgeschlagenen
  Chunk-Import einmal neu (`vite:preloadError` in `frontend/src/main.tsx`).
- **MCP-Zustimmung und Ursprung:** Die Zustimmungsanfrage ist per Cookie `oauth_consent_<id>` (HttpOnly, SameSite=Lax, Pfad `/api/oauth`) an den Browser gebunden, der `GET /api/oauth/authorize` aufgerufen hat. Standard (SPA und API unter einem Ursprung) braucht nichts. Bei getrennten Ursprüngen (`VITE_API_URL`) muss die SPA auf derselben Site (gleiche registrierbare Domain, z. B. `app.example.com` und `api.example.com`) liegen, sonst sendet der Browser das Cookie nicht und die Zustimmung zeigt „Anfrage abgelaufen“; CORS erlaubt Credentials nur für den exakten `FRONTEND_URL` und nur auf `/api/oauth/authorization-request/*` und `/api/oauth/authorize/decision`.
- **Mapbox-Limits:** Pro Stunde: Tiles (`/api/mapbox/…/v4/…`) 1800 je Nutzer und 3600 je IP, Styles/Fonts 900 je Nutzer (zusätzlich 60000 je Tag für die gesamte Instanz), anonyme statische Karten (`/api/map/image/*`) 360 je IP; Cache-Treffer zählen mit, Überschreitung ist 429 `rate_limited` mit `Retry-After`. Die globalen Budgets (`mapbox_proxy_*`, `mapbox_image_*`) bleiben als äußere Grenze. Hinter einem Reverse Proxy muss `SYMFONY_TRUSTED_PROXIES` gesetzt sein, sonst teilen sich alle Clients die Proxy-IP und damit die IP-Limits.
- **PDF-Export:** `GET /api/calendars/{id}/events.pdf` (dompdf) braucht `ext-gd` und `ext-intl` (das Docker-Image installiert beide). Die Route hebt `memory_limit` auf 512M und die Ausführungszeit auf 60 s an (nur für sich, danach zurückgesetzt); Proxy-Timeouts auf `/api/*` müssen mindestens 60 s erlauben. dompdf schreibt Fonts/Temp nach `var/cache/<env>/pdf` (für den PHP-Nutzer beschreibbar). Rate-Limit 10/Nutzer und 30/IP je 10 Minuten.

API-Referenz: [`../api/openapi.yaml`](../api/openapi.yaml). Offene Punkte: [`BACKLOG.md`](BACKLOG.md). E2E-Umgebung: [`E2E.md`](E2E.md).
