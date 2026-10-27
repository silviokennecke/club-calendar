# Offene Backend-Lücken und Risiken

Stand: 2026-10-15. Alle Design-Features haben ein Backend; die Umsetzung der Pakete 1–5 und der Feed-Status steht in
den Commits, in `BACKEND-PLAN.md` (Plan, abgeschlossen), in der API-Referenz `docs/api/openapi.yaml` (Endpoints,
Schemas, Fehlercodes, Regeln) und in den Tests (`backend/tests`). Hier stehen nur noch offene Punkte, offene
Sicherheitsrisiken und Hinweise für den Betrieb. Zuordnung zu den Artboards: `COVERAGE.md`; Redesign-Plan: `PLAN.md`;
E2E-Umgebung: `E2E.md`.

## Offene Backend-Features

### Konten

- **Theme** wird nur im Browser gespeichert (localStorage), nicht am Benutzer (bewusst laut `PLAN.md`).
- **E-Mail-Wechsel für SSO-only-Konten** ist nicht möglich (409 `no_password`), bis ein Passwort gesetzt ist
  ("Passwort per E-Mail festlegen" im Profil); eine Bestätigung über eine erneute SSO-Anmeldung gibt es nicht.
- **Keine Mail an eine bereits vergebene neue Adresse** (bewusst, Paket 5): weder Bestätigungslink noch Hinweis; der
  Wechsel bleibt unsichtbar wartend (kein Orakel, und sonst könnte jeder beliebigen Kontoinhabern Mails schicken).
  Die bisherige Adresse bekommt den Hinweis trotzdem. Keine Hinweis-Mail bei "Passwort vergessen" (Spam-Vektor).
- **Mehrere Konten desselben Anbieters** (z. B. zwei Google-Konten) lassen sich nicht verknüpfen (`already_linked`).

### Termine und Serien

- **Serienregel ändern** betrifft nur künftige Termine; vergangene Termine einer Reihe lassen sich nicht über die Regel
  ändern (nur einzeln). Neue Termine übernehmen die Werte EINES Prototyps (frühester künftiger Termin), nicht etwa
  Mehrheitswerte der Reihe.
- **Regelumfang:** ein Wochentag je Regel, Rhythmen wöchentlich / zweiwöchentlich / monatlich am n-ten Wochentag
  (Design). Die API kann das Ende auch per Anzahl (`count`); das Design und die UI nutzen nur "Bis".
- **Zielgruppen** haben keine Farbe/Tonalität; das Frontend vergibt die Tag-Töne reihum nach Position.
- **Zeitzone der Termine:** Termine aus dem Formular speichern `timezone = null`; ICS und öffentlicher Feed fallen auf
  Kalender-, dann Vereinszone zurück. Die interne Terminliste liefert die gespeicherte Zone (`null` möglich).

### Feeds und öffentlicher Zugriff

- **Kurze Adressen** (`/k/<verein>/<feed>`, `?key=` im Design) bräuchten Slugs je Verein und Feed (COVERAGE L5).
  Heute: Webansicht `…/feed/{id}?secret=…`, ICS `{API}/api/feed/{id}/ics?secret=…`.
- **Geheimnis** wird für jeden Feed erzeugt und ausgeliefert, auch für öffentliche und nur per Linke (nur bei
  privaten relevant). Beim Wechsel von Privat zu Öffentlich/Nur per Link bleibt es unverändert; beim Wechsel von
  Öffentlich/Nur per Link zurück zu Privat erzeugt `FeedService::update()` immer ein **neues** Geheimnis (das alte
  kann in der offenen Phase in geteilten Links, Logs oder dem Browserverlauf gelandet sein und darf nicht wieder
  Zugriff geben); die Feedliste zeigt danach die neuen Adressen.
- **Archiviert vs. unbekannt:** beide 404 ohne Code; ein Zustand "Kalender archiviert" bräuchte einen eigenen
  Status/Code. Falsches und fehlendes Geheimnis sind nicht unterscheidbar (für Gäste gewollt).
- **Indexierung:** gesteuert je Feed (indexierbar genau bei Status `PUBLIC`; die Option `searchable` entfiel mit `Version20261021120000`, siehe "Feed-Status"). Die SPA-Seiten
  `/feed/*` bekommen ihr noindex nur per `<meta>` (aus `feed.indexable`); der Webserver sendet für sie kein
  `X-Robots-Tag` (bewusst nur Backend). Ein Abschalten der Option entfernt bereits indexierte Seiten erst beim
  nächsten Besuch der Suchmaschine.

### Import und Export

- **Wiederholungen (RRULE)** werden im Browser nur in der Teilmenge aus Paket 5 ausgeschrieben (BYSETPOS, BYHOUR,
  BYWEEKNO, BYYEARDAY, stündlich u. ä.: nur der erste Termin, mit Warnung). Importierte Instanzen sind
  **Einzeltermine** (keine Serie der App, bewusst: beliebige RRULEs passen nicht in das Serienmodell).
- **Duplikate innerhalb einer Datei** werden nicht verglichen (zwei VEVENTs mit gleicher UID ohne RECURRENCE-ID kommen
  beide in die Liste). Instanzen einer Wiederholung haben je eine eigene UID (`UID#YYYYMMDD`).
- **Veraltete Zuordnungen zwischen Vorschau und Import** lassen den Import als Ganzes scheitern (422
  `unknown_reference`, nichts gespeichert, UI: "Es wurde nichts importiert").
- **ICS-Zeilenlänge:** `X-APPLE-STRUCTURED-LOCATION` wird von `eluceo/ical` nicht auf 75 Oktette gefaltet (Parser wie
  sabre/vobject lesen die Datei trotzdem). Serientermine erscheinen in Feeds und Export als einzelne VEVENTs ohne
  RRULE/Serienkennung (bewusst: Abos sehen so auch einzeln geänderte oder gelöschte Termine richtig). **Kein
  `X-CC-SERIES-ID`** (bewusste Entscheidung, Paket 5): eine Serienkennung im ICS würde Serien-Interna im öffentlichen
  Feed preisgeben; ein Wiederimport erkennt Termine über die UID des Exports.

### Listen und Mitglieder

- **Doppelte Namen** von Eigenschaften/Features/Zielgruppen aus der Zeit vor Paket 1 bleiben erhalten; es gibt keinen
  Unique-Index (die Prüfung ist eine Komfortprüfung, gleichzeitige Anlagen können beide durchgehen).
- `PATCH /api/clubs/{id}` kann die Zeitzone ändern; das Design zeigt sie nur im Seitenkopf, daher kein UI-Feld.

### Dokumentation

- Das Frontend leitet seine API-Typen von Hand ab (`frontend/src/lib/types.ts`), nicht aus `docs/api/openapi.yaml`.
- Kein eigener E2E-Seed außer den Fixtures (die Suite bestätigt Nutzer mit `app:user:verify` und holt Reset-Links mit
  `app:user:reset-link`).

## Offene Sicherheitsrisiken

**Siehe Security-Audit** (Bericht des Auftraggebers, nicht im Repository): Rollen/letzter Admin (umgesetzt),
Vorab-Registrierung mit fremder Adresse (Pre-Hijacking, nachgestellt in
`SessionInvalidationTest::testPreRegisteredPasswordStillWorksAfterTheOwnerConfirms`), Mapbox-Proxy (jetzt nur für angemeldete Nutzer, `access_control` `^/api/mapbox/`; anonym bleiben nur die statischen Kartenbilder `/api/map/image/*`),
Microsoft-SSO ohne vertrauenswürdiges `email_verified` (inkl. "unbestätigtes Microsoft-Konto blockiert die
Registrierung"), Rate-Limiting für Login/Token/Passkey/OAuth-Callback, Host-Header, ICS-Injection, CSP/Header, Tokens
im SSO-Redirect, Quoten und unbegrenzte ID-Listen, Konto-Enumeration
(Registrierung, Login-Timing, OAuth), Kartenbilder privater Termine/Orte, CORS-Regex, Geheimnisse/Deploy.

Nicht im Audit, gering:

| Schweregrad | Risiko | Details / mögliche Behebung |
| --- | --- | --- |
| mittel | **MCP: Clientnamen ungeprüft** | Per Dynamic Client Registration kann sich jeder Client mit beliebigem `client_name` registrieren (nur die Redirect-URI-Familie in `MCP_ALLOWED_CLIENTS` wird geprüft); die Zustimmungsseite zeigt deshalb den Redirect-Host und "nicht verifizierte App". Mit leerem `MCP_ALLOWED_CLIENTS` sind alle Clients erlaubt. |
| niedrig | **MCP: Request-ID nicht an Nutzer gebunden** | `OAuthAuthorizationRequest` (10 Minuten, einmalig) wird erst bei der Entscheidung an den angemeldeten Nutzer gebunden; wer die Request-ID kennt, könnte als angemeldeter Nutzer zustimmen. Die ID ist zufällig und steht nur in der Zustimmungs-URL. |
| niedrig | **MCP: Grok-Callback unbekannt** | Für die Familie `grok` ist keine offizielle Callback-URL bekannt, sie akzeptiert nichts (`RedirectUriPolicy`); Regeln nachtragen, sobald sie feststehen. Die Regeln der übrigen Familien vor dem Go-live erneut prüfen. |
| niedrig | **MCP: Bundle vor 1.0** | `symfony/mcp-bundle` ist auf `~0.14.1` gepinnt (mcp/sdk 0.8.1); API und Verhalten können sich bei Updates ändern, Updates nur mit laufender `McpEndpointTest`/Tool-Tests. |
| niedrig | **ID-Token-Claims ungeprüft** | `OidcProvider` prüft beim ID-Token weder Signatur noch `aud`/`iss`/`exp`. Das Token kommt direkt vom Token-Endpoint über TLS (nach OIDC zulässig), im Code-Flow mit Client-Secret nicht ausnutzbar; `iss` ist bei Microsoft `common` mandantenabhängig. |
| niedrig | **Passwort-Hashing** | `App\Entity\User` nutzt explizit `bcrypt` (Kosten 13) statt `auto`; 8–128 Zeichen (`PasswordPolicy`), Symfony hasht Passwörter über 72 Bytes vorab. Umstellung auf `auto` (argon2id) mit Rehash bei Anmeldung möglich. |
| niedrig | **User-Verification optional** | `WEBAUTHN_USER_VERIFICATION=preferred` (Standard) lässt Passkeys ohne PIN/Biometrie zu; `required` ist strenger, schließt aber Sicherheitsschlüssel ohne PIN aus. |

## Betrieb

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
- **MCP / OAuth:** `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` (und `…/api/mcp`) sowie `/api/mcp` müssen zu PHP geroutet werden (`.htaccess`, `docker/Caddyfile` tun das; nginx: eigene `location`-Blöcke auf `index.php`, `/.well-known` nicht per Dotfile-Regel sperren, für `/api/mcp` `fastcgi_buffering off`). Hinter einem Proxy `/api/mcp` nicht puffern und lange Verbindungen (SSE) erlauben. Env: `MCP_ACCESS_TOKEN_TTL`, `MCP_REFRESH_TOKEN_LIFETIME`, `MCP_REFRESH_TOKEN_ABSOLUTE_LIFETIME`, `MCP_REFRESH_TOKEN_REUSE_GRACE`, `MCP_ALLOWED_CLIENTS` (`backend/.env.example`; leer = alle Clients). Migration `Version20261025120000` (OAuth-/MCP-Tabellen) und `Version20261026120000`. Cron `app:prune-oauth` (täglich). Nutzer sehen und widerrufen Verbindungen im Profil; Passwortänderung und "Überall abmelden" beenden alle MCP-Zugänge. Browser-Clients auf fremder Origin scheitern an CORS (nur `FRONTEND_URL`).
- **Mail-Templates:** nach Änderungen an `templates/email/*.mjml` `npm run build:mail -w backend` (die kompilierten
  `*.html.twig` sind eingecheckt; `npm run build` baut sie ebenfalls). Seit Paket 5 auch `password_changed`,
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
  läuft hinter einem TLS-Terminator und setzt es nicht: **dort `Strict-Transport-Security: max-age=31536000` ergänzen**
  (erst `includeSubDomains`/`preload`, wenn alle Subdomains HTTPS können). Getrennte Hosts (`VITE_API_URL` auf anderer
  Origin): API-Origin in `connect-src` der CSP aufnehmen. nginx, im `server`-Block (nicht vergessen: `add_header` wird in
  verschachtelten `location`-Blöcken nicht geerbt, also auch im Feed-Block wiederholen, dort mit `no-referrer`):
  ```nginx
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; child-src blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()" always;
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Strict-Transport-Security "max-age=31536000" always;
  location ~ /\.(?!well-known)|\.(env|pem|log)$ { deny all; }
  ```
  Offen: `style-src 'unsafe-inline'` bleibt (React-`style=`-Attribute, emoji-mart und mapbox-gl injizieren Styles).
- **Nach einem Deploy** fehlen die Chunks des vorigen Releases; das Frontend lädt bei einem fehlgeschlagenen
  Chunk-Import einmal neu (`vite:preloadError` in `frontend/src/main.tsx`).
