# Backend-Lücken und offene Risiken (Endstand Redesign)

Stand: 2026-10-13, nach Paket 3 des Umsetzungsplans (`BACKEND-PLAN.md`; vorher: Paket 2 am selben Tag, 2026-10-09 nach Paket 1, 2026-10-06 nach Phase 9). Hier steht, was das Design braucht und das Backend (noch) nicht bietet, welche
Sicherheitsrisiken offen sind, welche Backend-Fehler während des Redesigns behoben wurden und was im Betrieb zu tun
ist. Zuordnung zu den Artboards: `COVERAGE.md`; Umsetzungsplan: `PLAN.md`; E2E-Umgebung: `E2E.md`.

## Kurzfassung und Prioritäten

1. **Vor produktiver Nutzung (Betrieb):** Migrationen `Version20261004120000` (Tabelle `auth_nonce`),
   `Version20261004130000` (`user.token_version`), `Version20261009120000` (Vorlagen-Zeiten), `Version20261010120000`
   (`event.external_uid`) und `Version20261013120000` (Paket 3: `password_reset`, `email_change`,
   `passkey.last_used_at`, `club_user.last_calendar_id`) auf Dev und Prod ausführen; `APP_SECRET`,
   `JWT_REFRESH_SECRET`, `BACKEND_URL` und `WEBAUTHN_*` in Produktion setzen; SSO nur über HTTPS (State-Cookie); Cron
   `app:prune-password-resets`. Siehe "Betrieb".
2. **Sicherheit, mittel:** Vorab-Registrierung mit fremder Adresse (Passwort des Registrierenden gilt nach dem Klick
   des Eigentümers), fehlendes Rate-Limiting, nicht rotierende/widerrufbare Refresh-Tokens. Siehe "Offene
   Sicherheitsrisiken".
3. **Features mit sichtbarer UI-Lücke ("Bald verfügbar"):** Terminserien (Paket 4). Passwort vergessen/zurücksetzen,
   SSO verknüpfen/trennen und Profil (Name/E-Mail/Passwort) sind umgesetzt (Paket 3, siehe "Umgesetzt (Paket 3)").
4. **Zähler und Einzel-Endpoints:** umgesetzt (Paket 1, siehe "Umgesetzt (Paket 1)"). Offen bleiben kurze
   Feed-Adressen (Slugs) und ein Zustand "Kalender archiviert" im öffentlichen Feed.
5. **Robustheit:** Import-Vorschau, atomarer Import, Export-Endpoint, Sammelaktionen und stabile Fehlercodes sind
   umgesetzt (Paket 2, siehe "Umgesetzt (Paket 2)"). Offen: RRULE-Auflösung beim Import, Codes für die übrigen 4xx.

## Offene Backend-Features

### Auth und Konten

Umgesetzt in Paket 3 (siehe "Umgesetzt (Paket 3)"). Offen bleibt:

- **Theme** wird nur im Browser (localStorage) gespeichert, nicht am Benutzer (bewusst laut Plan; nur relevant,
  falls geräteübergreifend gewünscht).
- **E-Mail-Wechsel für SSO-only-Konten:** nicht möglich (409 `no_password`), bis ein Passwort gesetzt ist ("Passwort
  per E-Mail festlegen" im Profil). Eine Bestätigung über eine erneute SSO-Anmeldung gibt es nicht.
- **Hinweis-Mail an die bisherige Adresse** bei Passwort- oder E-Mail-Änderung fehlt (üblich als Warnung bei
  Kontoübernahme); ebenso keine Mail an eine bereits vergebene neue Adresse (der Wechsel bleibt unsichtbar wartend).
- **Mehrere Konten desselben Anbieters** (z. B. zwei Google-Konten) lassen sich nicht verknüpfen (`already_linked`).

### Termine und Serien

- **Terminserien:** Event hat keine Wiederholungsregel (Design: EventSeries). Die Seite "Termin aus Vorlage" ist
  gebaut; Regel (wöchentlich, zweiwöchentlich, n-ter Wochentag), Feiertage auslassen und Vorschau laufen
  clientseitig (`src/lib/events/series.ts`), "Serie anlegen" ist deaktiviert (COVERAGE L3). Einzeltermine nutzen
  `POST …/events/from-template` mit einem Datum; der Endpoint nimmt schon mehrere Daten an und legt unverbundene
  Einzeltermine an. Für echte Serien fehlen Serien-ID/Regel am Event und Endpoints für "nur dieser Termin / alle
  Termine der Serie" (Design: Serien-Dialoge).
- **Zielgruppen** haben keine Farbe/Tonalität; das Frontend vergibt die Tag-Töne reihum nach Position.
- **Zeitzone der Termine:** `Event.timezone` ist `null` für Termine aus dem Terminformular (es sendet keine Zone);
  `IcsService` und der öffentliche Feed fallen auf Kalender-, dann Vereinszeitzone zurück (seit Paket 1). Die interne
  Terminliste liefert weiterhin die gespeicherte Zone (`null` möglich).

### Feeds und öffentlicher Zugriff

- **Kurze Adressen:** Das Design zeigt `/k/<verein>/<feed>` und `?key=`; dafür bräuchte es Slugs je Verein und
  Feed. Heute: Webansicht `…/feed/{id}?secret=…`, ICS `{API}/api/feed/{id}/ics?secret=…`.
- **Geheimnis** wird auch für öffentliche Feeds erzeugt und ausgeliefert (nur bei privaten relevant).
- (Frontend, behoben) Der Feed-Typ hieß `targetGroupid` (API: `targetGroupId`), die alte Feedliste zeigte daher keine
  Zielgruppen.
- **Archiviert vs. unbekannt:** beide 404; die Seite zeigt "Kalender nicht gefunden oder nicht veröffentlicht".
  Ein Zustand "Kalender archiviert" bräuchte einen eigenen Status/Code. 403/404 sind RFC-7807 ohne stabilen Code;
  falsches und fehlendes Geheimnis sind nicht unterscheidbar (für Gäste gewollt).
- **Header:** `Referrer-Policy` / `X-Robots-Tag` setzt die SPA nur per `<meta>` (`no-referrer`, `noindex` bei
  privaten Feeds laut `visibility` und bei Fehlerzuständen); stärker wäre ein HTTP-Header am Webserver für `/feed/*`.
- **Karten:** `/api/map/image/location/{id}` (statisches Bild) ist öffentlich, die interaktive Karte nutzt den
  Mapbox-Proxy `/api/mapbox/*`; beide über das Backend, das Token geht nie an Dritte. Rate-Limit des Bild-Endpoints
  gilt pro Client. Zum Datenschutz siehe "Offene Sicherheitsrisiken".

### Import und Export

- **Wiederholungen (RRULE):** Der Import legt je VEVENT einen Termin an; Wiederholungsregeln werden weder im Browser
  noch in der Vorschau ausgeschrieben (Hinweis "Wiederholt sich" in der Prüfansicht). Braucht das Serien-Modell
  (Paket 4).
- **Restfall Import:** Wurden Zuordnungen (Eigenschaften, Orte, ...) zwischen Vorschau und Import gelöscht, scheitert
  der Import als Ganzes (422 `unknown_reference` mit `events[n].feld`, nichts gespeichert); die UI zeigt "Es wurde
  nichts importiert".
- **Duplikate innerhalb einer Datei** werden nicht verglichen (Ausnahmen einer ICS-Serie teilen ihre UID). Folge:
  Ein Termin mit bekannter UID an einem neuen Tag (z. B. ein später ergänzter Serientermin) gilt als Duplikat des
  ersten Termins mit dieser UID und wird mit `skipDuplicates` übersprungen; in der Prüfansicht ist er nur markiert.
- **Speicher:** 5000 Termine mit Zuordnungen brauchen im Import rund 130 MB zusätzlich (gemessen, eine
  Transaktion); `memory_limit` des Servers entsprechend wählen (Container: 256M). Ein Body von 5000 Terminen ist
  etwa 2–3 MB groß: liegt er über `post_max_size`, liest PHP den JSON-Body trotzdem, gibt aber eine Warnung aus; mit
  `display_errors=On` (lokale CLI-Standardwerte, `php -S`) geht sie der Antwort voran (Status 200, HTML-Präfix, der
  Import ist trotzdem gespeichert). `post_max_size` daher großzügig setzen (Container: 16M), `display_errors` aus.
- **ICS-Zeilenlänge:** `X-APPLE-STRUCTURED-LOCATION` (Ort mit Koordinaten) wird von `eluceo/ical` nicht auf 75 Oktette
  gefaltet (Feeds und Export gleichermaßen; Parser wie sabre/vobject lesen die Datei trotzdem).
- **CSV-Export** ist weder im Design noch gebaut.
- **Vorschau-Last:** Die Vorschau läuft nach jeder Bearbeitung in der Prüfansicht erneut (300 ms entprellt, bis zu
  5000 Termine je Request).

### Zähler und Listen

- Feiertage je Feiertagskalender gibt es nur über den Zeitraum-Endpoint `holiday-events` (und im öffentlichen Feed).
- Bestehende doppelte Namen (vor Paket 1 angelegt) bleiben erhalten; es gibt keinen Unique-Index (siehe Paket 1).
- ID-Listen (`targetGroupIds` usw.) haben keine Längenbegrenzung (eine Abfrage je ID).

### Rollen und Mitglieder

- Keine Rollen: Jedes Mitglied darf jedes andere (und sich selbst, auch als letztes Mitglied) entfernen und den
  Verein löschen; kein Schutz vor einem Verein ohne Mitglied.
- `POST …/members` für eine bereits eingetragene Person legt nichts an und antwortet trotzdem erfolgreich (das
  Frontend prüft Duplikate lokal). Die 404 "User not found" verrät, ob zu einer Adresse ein Konto existiert (vom
  Design so gewollt: "Zu dieser E-Mail-Adresse gibt es kein Konto").
- `PATCH /api/clubs/{id}` kann die Zeitzone ändern; das Design zeigt sie nur im Seitenkopf, daher kein UI-Feld.
- Fremder vs. unbekannter Verein: `GET /api/clubs/{id}` und `…/calendars` antworten mit 4xx; das Frontend zeigt
  "Nicht verfügbar". Einheitlich 403 (fremd) / 404 (nicht vorhanden) wäre für die Texte hilfreich.

### Dokumentation und Betrieb

- Root-`AGENTS.md` listet die Backend-Module und die Bausteine der Bugfix-/Sicherheits-Runden (`CalendarReferences`,
  `LinkCollectionSync`, `Input`, `SessionVersionListener`, `SignedTokenService`/`NonceStore`) nur knapp; das
  Verhalten ist hier unter "Behobene Bugs" beschrieben. Eine API-Referenz (OpenAPI) gibt es nicht; das Frontend
  leitet Typen von Hand ab (`frontend/src/lib/types.ts`).
- Kein eigener E2E-Seed außer den Fixtures (Nutzer bestätigt die E2E-Suite seit Paket 3 mit `app:user:verify`,
  Reset-Links holt sie mit `app:user:reset-link`).

## Umgesetzt (Paket 3)

Auth und Konten (`BACKEND-PLAN.md` Paket 3). Migration `Version20261013120000`: Tabellen `password_reset` und
`email_change` (je `user_id` mit `ON DELETE CASCADE`, `token_hash` = SHA-256 des Tokens mit eindeutigem Index,
`expires_at`, `used_at`, `created_at`, alle Zeiten UTC), `passkey.last_used_at`, `club_user.last_calendar_id` (ohne
Fremdschlüssel). Neue Felder sind Ergänzungen; bestehende Antwortformen bleiben gleich.

- **Passwort vergessen** `POST /api/auth/forgot-password {email}` → immer 204 (unbekannte, unbestätigte und
  SSO-only-Adressen gleich; auch über dem Limit). Token: 32 Byte CSPRNG (hex), gespeichert nur als SHA-256-Hash; ein
  neuer Link löscht die offenen älteren des Nutzers; 60 Minuten gültig. Die Mail geht an die gespeicherte Adresse des
  Kontos mit `{FRONTEND_URL}/reset-password?token=…` (aus der Konfiguration, nie aus dem Host-Header; der Link steht
  auch als Text in der Mail, damit der Text-Teil ihn enthält). Suche, Token und Mail laufen erst nach der Antwort
  (`App\Service\DeferredMailer::defer()`, `kernel.terminate`): weder SMTP noch die Datenbank-Schreibvorgänge für ein
  vorhandenes Konto verzögern die Antwort (gemessen vorher ~15 ms vs. ~9 ms, nachher gleich).
  Limiter `password_reset_email` (3/Stunde je normalisierter Adresse, `mb_strtolower(trim())`) und
  `password_reset_ip` (20/Stunde je Client-IP); über dem Limit 204 ohne Mail. Tests `PasswordResetTest`.
- **Zurücksetzen** `POST /api/auth/reset-password {token, password}` → 204 oder 400 `invalid_reset_token` (unbekannt,
  benutzt, abgelaufen: gleiche Antwort). Einmalnutzung über EIN bedingtes `UPDATE … SET used_at WHERE token_hash = ?
  AND used_at IS NULL AND expires_at > ?` in einer Transaktion (von zwei gleichzeitigen Anfragen ändert genau eine die
  Zeile), danach Vergleich per `hash_equals`. Setzt das Passwort, `isEmailVerified = true` (Besitz der Adresse ist
  bewiesen), erhöht `token_version` (alle Sitzungen enden, die Antwort enthält keine Tokens), entwertet die übrigen
  Links, löscht offene Bestätigungslinks und verwirft einen wartenden E-Mail-Wechsel (er kann von jemandem stammen,
  der das alte Passwort kannte). War die Adresse noch unbestätigt, werden wie bei der ersten Bestätigung per
  Link SSO-Verknüpfungen und Passkeys aus der unbestätigten Zeit entfernt. **SSO-only-Konten bekommen so ein Passwort**
  (Profil: "Passwort per E-Mail festlegen" löst forgot-password für die eigene Adresse aus).
- **Passwort-Policy** überall gleich (`App\Validator\PasswordPolicy`: 8–128 Zeichen; Registrierung, Reset, Wechsel; im
  Frontend `lib/password.ts`, Zeichen = Code Points). bcrypt liest nur 72 Bytes; Symfonys `NativePasswordHasher`
  hasht längere Passwörter vorab (SHA-512, base64), die 128 begrenzt die Eingabe (keine Kilobyte-Passwörter).
- **Profil:** `PATCH /api/auth/me` nimmt `name` (trim, 1–255, sonst 422 `validation_failed` field `name`).
  `POST /api/auth/change-password {currentPassword, newPassword}` → 200 mit neuen Tokens (`tokenResponse`): die
  Version wird erhöht, alle anderen Sitzungen enden, die eigene läuft mit den neuen Tokens weiter (Entscheidung); ein
  wartender E-Mail-Wechsel wird verworfen (sonst bewegte sein Link das Konto nach der Rettung durch den Eigentümer
  doch noch auf die Adresse dessen, der das alte Passwort kannte); falsches Passwort 400 `invalid_credentials` (field `currentPassword`; 400 statt 401, damit der Client nicht den
  Refresh versucht), SSO-only 409 `no_password`.
- **E-Mail ändern** `POST /api/auth/change-email {email, password}` → 204; Passwort Pflicht (falsch 400
  `invalid_credentials` field `password`), SSO-only-Konten 409 `no_password` (Entscheidung: ohne Passwort keine
  erneute Anmeldung; erst Passwort festlegen), gleiche Adresse 422. Der wartende Wechsel (`email_change`, 24 h) wird
  **immer** angelegt und in `GET /api/auth/me` als `pendingEmail` gezeigt; einen Link (an die NEUE Adresse,
  `{BACKEND_URL}/api/auth/verify-new-email?token=…`, nach der Antwort verschickt) gibt es nur, wenn die Adresse frei
  ist. Eine vergebene Adresse (Vergleich per Kollation wie der eindeutige Index von `user.email`; Nicht-ASCII-Adressen
  lehnt die E-Mail-Validierung ab) bekommt keinen Link, sieht aber gleich aus (kein Orakel, auch nicht über
  `pendingEmail`). Limiter `email_change_request` (5/Stunde je Konto, darüber 204 ohne Mail; das Passwort wird vorher
  geprüft). `DELETE /api/auth/change-email` verwirft den wartenden Wechsel.
  `GET /api/auth/verify-new-email?token=` leitet auf `{FRONTEND_URL}/auth/verify-email?status=email_changed` bzw.
  `?status=error&reason=invalid|expired|already_used|email_taken&flow=email_change` (Adresse zwischenzeitlich
  vergeben, auch per Unique-Index-Race). Erfolg: Adresse gesetzt und bestätigt, `token_version` erhöht, offene
  Bestätigungslinks gelöscht. **Zusammenspiel mit Tokens:** Access-Tokens tragen die alte Adresse (Lookup über die
  E-Mail) und die alte Version → 401; der Refresh nennt den Nutzer per `sub` (ID), scheitert aber an der Version →
  401 `invalid_refresh_token`; der Client landet auf `/login` und meldet sich mit der neuen Adresse an (bewusst: der
  Wechsel beendet alle Sitzungen, also kein "401 → Refresh → neue Tokens"). Ein altes Token öffnet nie ein Konto, das
  die frei gewordene alte Adresse neu registriert (`uid`-Claim). Tests `AccountTest`.
- **SSO verknüpfen** `POST /api/auth/oauth/{provider}/link-start` (JWT) → `{url}`: ein Einmal-Ticket auf der API
  (`/api/auth/oauth/{provider}/link?ticket=…`, signiert, Zweck `oauth.link_ticket`, 60 s, an Nutzer + `token_version`
  gebunden, einmalig über `auth_nonce`). Abweichung vom Plan ("Autorisierungs-URL"): das State-Cookie lässt sich per
  CORS-Fetch ohne Credentials nicht setzen, daher setzt erst die Navigation zum Ticket das Cookie und leitet zum
  Anbieter weiter. Der Link-State ist für einen eigenen Zweck signiert (`oauth.link_state`, Schlüssel je Zweck): er
  verifiziert nie als Login-State und umgekehrt; ein Link-Callback gibt nie Tokens aus, ein Login-Callback verknüpft
  nie mit einem angemeldeten Konto. Callback im Link-Modus: Nutzer muss noch existieren und dieselbe `token_version`
  haben; er verknüpft NOCH NICHT, sondern leitet auf `{FRONTEND_URL}/profile?link_provider=<provider>&link_proof=…`
  (signiert, Zweck `oauth.link_proof`, 5 Minuten, einmalig, nennt Nutzer, Version und Provider-Account). Das
  angemeldete Frontend schließt ab: `POST /api/auth/oauth/{provider}/link-complete {proof}` (JWT) → 204; nur wenn der
  JWT-Nutzer (mit derselben Version) den Vorgang gestartet hat, sonst 400 `invalid_state`. Grund (Link-CSRF, bei der
  Verifikation gefunden): Ohne diesen Schritt konnte jemand mit SEINER Sitzung `link-start` aufrufen und die
  Ticket-URL einem Opfer unterschieben; dessen Browser meldete sich (bei früherer Zustimmung ohne Rückfrage) beim
  Anbieter an, und der Callback hängte das Anbieter-Konto des OPFERS an den Nutzer des Angreifers (eine spätere
  SSO-Anmeldung des Opfers landete im Konto des Angreifers). Provider-Account (Provider + `sub`) wird unabhängig von
  `email_verified` angehängt; gehört er schon diesem Nutzer → idempotent, einem anderen → 409 `account_in_use` (nichts
  über das andere Konto), ein anderes Konto desselben Anbieters → 409 `already_linked`. Fehler des Redirects:
  `{FRONTEND_URL}/profile?link_error=<code>` (`invalid_state`, `provider_denied`, `provider_error`, `oauth_failed`). Fehler
  eines Link-States, der sich nicht verifizieren lässt (abgelaufen, fremder Browser), landen wie beim Login auf
  `/auth/callback?error=invalid_state` (der Modus ist dann nicht bekannt). Microsoft lässt sich so (angemeldet) mit
  einem bestehenden Konto verknüpfen.
- **SSO trennen** `DELETE /api/auth/oauth/{provider}` (JWT) → 204; nicht verknüpft 404 `oauth_account_not_found`;
  ohne Passwort, Passkey oder anderen Anbieter 409 `last_login_method` (die Zeile des Nutzers ist dabei gesperrt
  (`SELECT … FOR UPDATE`): zwei gleichzeitige Trennvorgänge entfernen nie beide letzten Anbieter). Erhöht die Version
  nicht (wie Passkey entfernen). `GET /api/auth/me` liefert `hasPassword`, `pendingEmail` und `oauthAccounts[].provider` (ohne `sub` und
  Anbieter-Adresse). Tests `OAuthLinkTest`.
- **Passkeys:** `last_used_at` wird bei erfolgreicher Anmeldung gesetzt (UTC), die Liste liefert `lastUsedAt`
  (ISO-8601, `null` bis zur ersten Nutzung); der Name bleibt optional (Backend-Default `null`, das Frontend zeigt
  dann "Passkey ohne Namen"). Test `WebAuthnTest::testSignInRecordsLastUsedAtInUtcAndTheListShowsIt`.
- **Letzter Kalender je Mitgliedschaft:** `PATCH /api/auth/me {lastClubId, lastCalendarId}` speichert den Kalender
  zusätzlich an der Mitgliedschaft (`club_user.last_calendar_id`), wenn er existiert, zum Verein `lastClubId` gehört
  und der Nutzer Mitglied ist (sonst still ignoriert, wie bisher). `GET /api/clubs` liefert je Verein
  `lastCalendarId` (nur wenn der Kalender noch existiert und zum Verein gehört; ein gelöschter Kalender ergibt
  `null`, ohne Fremdschlüssel). Frontend: `lib/lastCalendar.ts` (localStorage) entfällt; `pickCalendar` nimmt
  `club.lastCalendarId` (archiviert/gelöscht → wie bisher erster aktiver Kalender), `AppShell` aktualisiert die
  gecachte Vereinsliste, `ClubCard` verlinkt den gemerkten Kalender; alte `lastCalendar:*`-Schlüssel werden beim Start
  gelöscht (`lib/legacyStorage.ts`). Tests `AccountTest::testLastCalendar…`, E2E `account.spec.ts`.
- **Console-Commands:** `app:user:verify <email>` (markiert die Adresse als bestätigt; unbekannt → Exit 1; ohne die
  Bereinigung des Bestätigungslinks), `app:user:reset-link <email>` (Reset-Token wie oben, gibt NUR die URL aus,
  keine Mail; Dev/E2E/Support), `app:prune-password-resets` (löscht abgelaufene Reset-Links und abgelaufene
  E-Mail-Wechsel). Die E2E-Suite nutzt die Commands statt PDO (`e2e/helpers.ts` `backendConsole`, `resetLinkFor`).
- **Mails:** `templates/email/reset_password.mjml` und `confirm_new_email.mjml` im Stil der Bestätigungsmail, Texte
  de/en nach Sprache des Nutzers (`email.reset.*`, `email.change.*`), kompiliert nach `*.html.twig` (eingecheckt;
  `npm run build:mail -w backend` baut alle drei). Links nur auf `FRONTEND_URL` / `BACKEND_URL`; der Link steht zusätzlich
  als Text unter dem Button (`email.*.link_note`), sonst fehlte er im automatisch erzeugten Text-Teil. Der Name wird
  escaped. Die Bestätigungsmail der Registrierung hat diesen Text-Link weiterhin nicht.
- **Logs:** `App\Logging\RedactTokensProcessor` ersetzt `token`/`ticket`/`secret`/`refresh_token`/`code`/`state`/
  `link_proof` in Query-Strings von Lognachrichten und Kontext durch `[redacted]` (der Router loggt die Request-URI, bei
  einem Fehler landet sie im Log). Die Debug-SQL-Logs der Test-/Dev-Umgebung zeigen nur den Hash. Grenzen: Exception-
  Objekte im Kontext (Meldung, Trace) werden nicht bearbeitet; Access-Logs des Webservers (Caddy/Apache) und
  Referer-Header der ersten Seitenanfragen (`/reset-password?token=…` lädt die eigenen Skripte, bevor die Seite
  `no-referrer` setzt) enthalten den Token weiterhin (nur bis zur Einmalnutzung/60 Minuten verwertbar). Härter wäre
  der Token im Fragment (`#token=`), das weder Server noch Referer sehen.
- **Frontend:** `/forgot-password` aktiv (Zustände Formular, "Prüfe dein Postfach", Fehler; 429 = Erfolg), neue Seite
  `/reset-password` (GuestRoute; Token wird nach dem Lesen per `replace` aus der Adresse entfernt, `no-referrer`),
  `/auth/verify-email` kennt `status=email_changed` und die Fehler des Adresswechsels, Profil mit Name/E-Mail/Passwort,
  Verknüpfen/Trennen und Passkey "zuletzt benutzt" (COVERAGE: ForgotPassword, Profile). `lib/api.ts`: alle Fehler tragen
  `ApiError.code`, 204-Antworten werden zu `undefined`.

## Umgesetzt (Paket 1)

Zähler, Einzel-Endpoints, öffentlicher Kopf, optionale Vorlagen-Zeiten (`BACKEND-PLAN.md` Paket 1). Alle Zähler sind
je Zähler EINE gruppierte Abfrage über alle Zeilen einer Liste (`App\Service\UsageCounts`; Nachweis ohne N+1:
`CountersTest::test*RunsTheSameNumberOfQueries*` mit dem Test-Abfragezähler `tests/Helper/QueryCounter`, nur in
`config/services_test.yaml`). Neue Felder sind Ergänzungen; bestehende Antwortformen bleiben gleich.

- **Vereine:** `GET /api/clubs` und `GET /api/clubs/{id}` liefern `calendarCount` (aktive), `archivedCalendarCount`,
  `memberCount` (`_count.calendars` = alle Kalender bleibt). `GET /api/clubs/{id}` zusätzlich `eventCount` und
  `feedCount` (Summe über alle Kalender, auch archivierte = Umfang des Löschens). Frontend: Vereinsauswahl ohne
  Requests je Verein (Kalenderliste nur beim Öffnen eines Vereins), Lösch-Dialog "Löscht den Verein mit 2 Kalendern,
  14 Terminen und 2 Feeds sowie allen Vorlagen unwiderruflich. …".
- **Kalender:** Liste und Einzel-GET (und die übrigen Kalender-Antworten) liefern `eventCount`, `templateCount`,
  `feedCount`. Frontend: Kalenderzeile "n Termine" (COVERAGE L5), Kalender-Lösch-Dialog per Einzel-GET statt
  Terminliste, Leerzustand "Noch keine Termine in diesem Kalender" per `eventCount` statt kompletter Terminliste.
- **Nutzung:** Listen von Eigenschaften/Features `usage: {events, templates, eventNames}`, Zielgruppen zusätzlich
  `feeds`, Orte `usage: {events, templates, templateNames}`, Vorlagen (Liste + Einzel-GET) `eventCount` (Termine mit
  `event_template_id`). `eventNames`/`templateNames`: eindeutige Namen nur bei höchstens 3 Treffern (sonst `[]`,
  Design Dialogs.dc.html nennt Namen nur bei wenigen Terminen), eine zweite Abfrage nur für diese Einträge.
  Frontend: Lösch-Dialoge laden keine Termin-/Vorlagenlisten mehr (die Liste wird beim Öffnen neu geladen).
- **Einzel-Feed:** `GET /api/calendars/{calendarId}/feeds/{feedId}` (gleiche Serialisierung wie die Liste; Feed eines
  anderen Kalenders 404, Nicht-Mitglied 403). Frontend: `FeedEditPage` lädt den Feed einzeln.
- **Öffentlicher Feed:** `GET /api/feed/{id}/events` liefert `feed: {id, name, clubName, calendarName, timezone,
  visibility, eventCount, audiences}` (`timezone` = Kalender, sonst Verein, sonst UTC; `visibility` mit den Werten der
  Feed-API `PUBLIC|PRIVATE`; `eventCount`/`audiences` = alle veröffentlichten Termine des Feeds bzw. deren Zielgruppen,
  unabhängig von `from`/`to`, damit Filter-Chips und Leerzustand beim monatsweisen Laden stabil bleiben); jeder Termin
  trägt die wirksame Zone (`event.timezone` ?? Kalender ?? Verein); optionale `from`/`to` (YYYY-MM-DD, Überlappung wie
  intern, ungültig oder `to` < `from` → 400, Prüfung erst nach Geheimnis/Archiv); `holidays: [{id,
  holidayCalendarId, name, date, dateEnd}]` des Kalenders (mit `from`/`to` nur der Zeitraum).
  Neu `GET /api/feed/{id}/events/{eventId}` → `{feed, event}`: Geheimnis zuerst (403 auch für unbekannte Termine und
  Entwürfe, kein Orakel), dann archivierter Kalender 404, dann Termin (Entwurf, anderer Kalender, außerhalb der
  Zielgruppen des Feeds, unbekannt → 404). Frontend: Kopf "Verein" + "Kalender" (Design Public), Zeitzone und "heute"
  aus der API, `noindex` nach `visibility`, Feiertage in der Monatsansicht, Laden je Monatsraster (`from`/`to`),
  Termin-Dialog über den Einzel-Endpoint (aus dem Feed geöffnet zuerst mit den Daten des Feeds, ohne Ladezustand);
  bei 404 unterscheidet eine kleine Feed-Abfrage "Termin nicht gefunden" von "Kalender nicht gefunden". Tests
  `PublicFeedDetailsTest`. Liste und ICS laden Ort und Zuordnungen aller Termine gebündelt (Doctrine
  `FETCH_EAGER` je Abfrage, eine Abfrage je Zuordnung statt je Termin; Nachweis
  `PublicFeedDetailsTest::testFeedListRunsTheSameNumberOfQueriesForMoreEvents`).
- **Kalender duplizieren:** `POST …/calendars/{id}/duplicate` nimmt optional `{name}` (sonst "Copy of …"); das Frontend
  sendet "Kopie von …" direkt (kein PATCH mehr).
- **Doppelte Namen:** Eigenschaften, Features, Zielgruppen: Create/PATCH lehnen einen Namen ab, den es im Kalender
  schon gibt (trim inkl. geschützter und anderer Unicode-Leerzeichen wie `String.trim()` im Frontend,
  Groß/Kleinschreibung egal auch bei Umlauten, Vergleich in PHP, nicht per Datenbank-Kollation: "Ältere" ≠ "Altere",
  "Schießen" ≠ "Schiessen"; keine Unicode-Normalisierung, NFC "ä" ≠ NFD "a"+"̈"):
  422 `{code: "duplicate_name", field: "name"}` (neu: `App\Exception\ApiProblemException`, `ExceptionListener`
  ergänzt `code`/`field` im RFC-7807-Body; `ApiError.code` im Frontend). Bestehende Duplikate bleiben unberührt
  (kein Unique-Index). Ohne Index können zwei gleichzeitige Anlagen mit demselben Namen beide durchgehen (Race,
  akzeptiert: nur Komfortprüfung, keine Integritätsregel). Frontend: `MasterList` zeigt den Fehler am Feld.
- **Vorlagen-Zeiten optional:** Migration `Version20261009120000` macht `event_template.timezone`, `time_begin`,
  `time_end` nullable (Bestandsdaten unverändert; `down` füllt Leerwerte mit Europe/Berlin, 19:00, 21:00). Zeiten nur
  paarweise (eine allein → 400), Zeitzone optional (ungültig → 422). **Regel:** Hat die Vorlage keine Zeiten und
  bringt die Anfrage (`POST …/events/from-template`, `overrides.timeBegin/timeEnd`) keine, wird der Termin
  ganztägig (`isAllDay: true`, gespeichert als 00:00 – 23:59 wie Ganztagstermine aus Formular und Import);
  `overrides.isAllDay: false` ohne Zeiten → 400. Bringt die Anfrage Zeiten mit, gilt der Termin mit diesen Zeiten.
  Termine haben weiterhin immer Zeiten, ICS/öffentliche/interne Listen sind unverändert (`TemplateTimesTest`). Der
  Import kennt keine Vorlagen-Zeiten (er sendet eigene Zeiten). Frontend: Vorlagenformular startet leer (Design
  TemplateEdit), Karten/Auswahl/Termin-aus-Vorlage zeigen "Ganztägig"; das Terminformular mit Vorlage ohne Zeiten
  startet als ganztägig (gleiche Regel wie im Backend).
- **Aufgeräumt:** Frontend-Vorlauf `MULTI_DAY_LOOKBACK_DAYS` / `fetchRange` entfernt (Termine und Feiertage werden
  serverseitig nach Überlappung gefiltert).

## Umgesetzt (Paket 2)

Import, Export, Sammelaktionen, Fehlercodes (`BACKEND-PLAN.md` Paket 2). Neue Felder sind Ergänzungen; die alte
Import-Form (nur `events`) bleibt gültig.

- **Import-Bezug:** `Event.externalUid` (nullable, `VARCHAR(255)`, Index `(calendar_id, external_uid)`, Migration
  `Version20261010120000`), aus der ICS-UID befüllt (Frontend sendet `externalUid`; ohne UID in der Datei `null`, keine
  erfundene UID mehr). Die Terminlisten liefern `externalUid`.
- **Vorschau** `POST /api/calendars/{id}/events/import/preview` (Mitglied, nicht archiviert; gleicher Body und gleiche
  Grenzen wie der Import, schreibt nichts): `{events: [{index, status: "new" | "duplicate" | "invalid", duplicate?:
  {id, name, date, rule: "externalUid" | "nameDate"}, errors?: [{field: "events[n].feld", code, message}]}], summary:
  {total, new, duplicate, invalid}, warnings}`. Duplikat = Termin des Kalenders mit gleicher `externalUid` (auch die
  UID unseres eigenen Exports `event-<id>@club-calendar`; bei mehreren der am selben Tag), sonst gleicher Name am
  gleichen Startdatum (trim, Groß/Kleinschreibung egal wie `UniqueNames`, führende Icons wie "🎯 " ignoriert).
  Validierung = Import (`EventService::buildEvent` im Dry-Run, Referenzen nur aus dem eigenen Kalender über
  `CalendarReferences`). Eine Abfrage für den Duplikat-Index, Referenzdaten einmal vorgeladen (Nachweis
  `ImportTest::testPreviewRunsTheSameNumberOfQueriesForMoreEntries`).
- **Atomarer Import** `POST …/events/import`: `{events, locations?: [{tempId, name, street?, zip?, city?, country?,
  latitude?, longitude?}], skipDuplicates?: false}`; Termine verweisen mit `locationId` (bestehend) oder
  `locationTempId` (neu im selben Request; beides zugleich → 400). Antwort 201 `{imported, skipped, createdLocations:
  [{tempId, id}], ids, warnings}`. Ein Flush in einer Transaktion: scheitert ein Eintrag, wird nichts gespeichert
  (auch keine Orte); Fehler `events[n]: …` bzw. `locations[n]: …` mit `code` und `field` (`events[3].name`).
  Neue Orte werden nur angelegt, wenn ein importierter Termin sie nutzt (nicht für übersprungene Duplikate oder
  unbenutzte Einträge); `tempId` bis 1000 Zeichen (das Frontend bildet sie aus dem Ortsnamen).
  `skipDuplicates` überspringt Duplikate (nach der Vorschau-Regel), prüft sie aber trotzdem. **Obergrenze 5000
  Termine (und 5000 Orte) je Request** (`EventImportService::MAX_EVENTS`; darüber 413 `too_many_events`, field
  `events`); 5000 Termine laufen in einem Request (`ImportTest::testFiveThousandEventsImportInOneRequest`).
  **Veraltete/unbekannte Zeitzonen** (`US/Pacific-New`, Windows-Namen) scheitern nicht mehr: Kalenderzone (sonst
  Vereinszone) und `warnings: [{index, field: "timezone", code: "timezone_replaced", message, value, replacement}]`
  (auch in der Vorschau). Termin-Create/PATCH lehnen ungültige Zonen weiter mit 422 ab.
- **Export** `GET /api/calendars/{id}/events.ics?from&to&includeDrafts&targetGroupIds[]` (Mitglied, JWT; auch im
  Archiv lesbar): `IcsService` wie die Feeds (VTIMEZONE, Icons, Apple-Ort), Entwürfe nur mit `includeDrafts=1|true`
  als `STATUS:TENTATIVE`; `from`/`to` YYYY-MM-DD (ungültig oder `to` < `from` → 400 `validation_failed`),
  Überlappungsfilter wie die Terminliste; `targetGroupIds[]` (oder kommagetrennt, höchstens 100) nur aus dem eigenen
  Kalender (sonst 422 `unknown_reference`), Termine mit einer der Gruppen. `Content-Disposition: attachment;
  filename="<slug-des-kalenders>.ics"` (ASCII-Slug, max. 100 Zeichen, Fallback `termine.ics`), `Cache-Control:
  no-store`, `nosniff`. Ort und Zuordnungen gebündelt (`ExportBulkTest::testExportRunsTheSameNumberOfQueries…`).
- **Sammelaktionen** `POST /api/calendars/{id}/events/bulk` `{ids: [...], action: "publish" | "draft" | "delete"}` →
  200 `{affected}` (Mitglied, nicht archiviert). POST statt PATCH/DELETE auf der Sammlung: eine Route auch für das
  Löschen, mit JSON-Body (DELETE-Bodies werden nicht überall unterstützt). Atomar (eine Prüfabfrage, ein
  UPDATE/DELETE in einer Transaktion; Zuordnungen per `ON DELETE CASCADE`); alle IDs müssen zum Kalender gehören
  (unbekannt/fremd → 422 `unknown_reference`, field `ids`, nichts passiert); Duplikate (auch in anderer Schreibweise)
  zählen einmal; leere Liste, falsche Aktion oder keine Liste → 400 `validation_failed`; **Obergrenze 5000 IDs**
  (`EventService::BULK_MAX`, darüber 413 `too_many_events`).
- **Fehlercodes:** siehe "Fehlercodes" unten. Frontend: Registrierung erkennt `email_taken` (kein Textvergleich mehr),
  Login `email_not_verified` per `code`, SSO-Banner mit eigenem Text je OAuth-Code, Stale-Referenzen per
  `unknown_reference`.
- **Frontend:** Import-Prüfung über die Vorschau (bei Fehler Rückfall auf den Name+Datum-Vergleich im Browser), ein
  atomarer Request inkl. neuer Orte (keine 500er-Blöcke, keine "nur teilweise gelungen"-Ansicht), Warnungen und
  Obergrenze in Prüfansicht und Ergebnis; Export lädt `events.ics` (fetch mit JWT, Blob, `a[download]`, Fehler-Banner);
  Sammelaktionen über den Bulk-Endpoint (scheitert als Ganzes).

### Fehlercodes

RFC-7807-Body `{type, title, status, detail, code, field?}` über `App\Exception\ApiProblemException`
(`ExceptionListener`); `detail` bleibt menschenlesbar und ist kein Vertrag.

| Code | Status | Wo |
| --- | --- | --- |
| `validation_failed` | 400/422 | Eingabefehler mit `field` (`Input`, DTO-Validierung 422, Import `events[n].feld`, Export-Parameter, Bulk) |
| `invalid_request` | 400 | Body ist kein JSON-Objekt (alle JSON-Routen über `decodeJson`; kaputtes JSON auch bei den DTO-Routen Register/Login/Resend, Verein/Kalender anlegen, Mitglied hinzufügen), Passkey-Body unvollständig |
| `unknown_reference` | 422 | ID nicht im Kalender (`CalendarReferences`, Bulk-`ids`, Export-`targetGroupIds`, Import-`locationTempId`) |
| `duplicate_name` | 422 | Name im Kalender schon vergeben (Paket 1) |
| `too_many_events` | 413 | Import > 5000 Termine/Orte, Bulk > 5000 IDs |
| `email_taken` | 400 | Registrierung, field `email` |
| `invalid_credentials` | 401 / 400 | Login 401 (unbekannte Adresse und falsches Passwort gleich, kein Orakel); 400 bei `change-password` (field `currentPassword`) und `change-email` (field `password`) |
| `invalid_reset_token` | 400 | `reset-password`: Token unbekannt, benutzt oder abgelaufen (gleiche Antwort), field `token` |
| `no_password` | 409 | `change-password` / `change-email` für SSO-only-Konten |
| `last_login_method` | 409 | `DELETE /api/auth/oauth/{provider}`: es bliebe keine Anmeldemethode |
| `oauth_account_not_found` | 404 | `DELETE /api/auth/oauth/{provider}`: Anbieter nicht verknüpft |
| `unknown_provider` | 404 | `POST /api/auth/oauth/{provider}/link-start` |
| `invalid_state` / `account_in_use` / `already_linked` | 400 / 409 / 409 | `POST /api/auth/oauth/{provider}/link-complete`: Nachweis gefälscht, abgelaufen, benutzt oder von einem anderen Nutzer / einer beendeten Sitzung; Anbieter-Konto gehört einem anderen Nutzer; anderes Konto dieses Anbieters schon verknüpft |
| `email_not_verified` | 403 | Login mit unbestätigter Adresse; Body bleibt `{error: "email_not_verified", code: "email_not_verified"}` |
| `invalid_grant` | 400 | `POST /api/auth/token` ohne `grant_type=refresh_token` / Token |
| `invalid_refresh_token` | 401 | Refresh-Token ungültig, abgelaufen, Nutzer weg oder Sitzungen beendet |
| `invalid_passkey` | 401 | Passkey-Anmeldung gescheitert |
| `invalid_passkey_registration` / `passkey_already_registered` | 400 | Passkey-Registrierung |
| `passkey_not_found` | 404 | Passkey löschen (fremd oder unbekannt) |

E-Mail-Bestätigung (`GET /api/auth/verify-email`) leitet weiter wie bisher mit `?status=error&reason=invalid |
expired | already_used`; `resend-verification` antwortet immer 204 (kein Orakel), nur Eingabefehler tragen
`validation_failed`/`invalid_request`. Andere 4xx (403/404 der Voter, Datumsparameter der Terminliste, Feeds,
Feiertage) haben noch keinen Code.

**SSO verknüpfen** (`?link_error=` an `{FRONTEND_URL}/profile`): `invalid_state`, `provider_denied`, `provider_error`,
`oauth_failed`; nach Erfolg beim Anbieter `?link_provider=<provider>&link_proof=…`, abgeschlossen per
`POST …/link-complete` (Fehlercodes dort: `invalid_state`, `account_in_use`, `already_linked`). Neue-Adresse-Bestätigung: siehe
"Umgesetzt (Paket 3)".

**OAuth** (`?error=` an `{FRONTEND_URL}/auth/callback`): `invalid_state`, `provider_denied` (Anbieter meldet
`access_denied`, z. B. Abbruch der Einwilligung), `provider_error` (anderer Fehler des Anbieters, RFC 6749 4.1.2.1),
`oauth_failed` (Code-Tausch/Profil gescheitert), `email_missing`, `account_exists`, `email_unverified_at_provider`
(Google/Apple sagen, die Adresse sei dort nicht bestätigt; ein bestehendes Konto wird nicht verknüpft). Ein
Anbieter-Fehler wird erst nach gültigem `state` ausgewertet (sonst `invalid_state`). Microsoft liefert weiter
`account_exists` (sein Claim wird nie vertraut), ebenso Adressen, die nur per Kollation gleich sind.

## Offene Sicherheitsrisiken

| Schweregrad | Risiko | Details / mögliche Behebung |
| --- | --- | --- |
| mittel | **Pre-Hijacking bei lokaler Vorab-Registrierung** | Registriert jemand mit fremder Adresse und eigenem Passwort und klickt der echte Eigentümer den (unaufgefordert erhaltenen) Bestätigungslink, gilt das Passwort des Registrierenden: Er meldet sich danach an, auch neben einem späteren Google-Login des Eigentümers (Adresse ist dann bestätigt, keine Bereinigung). Die Sitzungs-Invalidierung hilft nicht (vor der Bestätigung gibt es keine Sitzung). Nachgestellt in `SessionInvalidationTest::testPreRegisteredPasswordStillWorksAfterTheOwnerConfirms`. Voraussetzung: Das Opfer klickt einen Link zu einer Registrierung, die es nicht angelegt hat. Seit Paket 3 kann der Eigentümer das Passwort zurücksetzen (ersetzt das fremde Passwort, beendet alle Sitzungen, entfernt bei unbestätigter Adresse auch SSO-Links und Passkeys); der Klick auf den Bestätigungslink allein behebt es weiterhin nicht (Audit-Thema). |
| mittel | **Kein Rate-Limiting** | `/api/auth/login`, `/api/auth/token`, Passkey-Verify und OAuth-Callback sind unbegrenzt (Brute Force, Credential Stuffing). Symfony RateLimiter je IP + Konto. |
| mittel | **Refresh-Tokens ohne Rotation/Widerruf** | Zustandslos, 7 Tage: Wiederverwendung bleibt unbemerkt, Abmelden und Passkey-Entfernen beenden bestehende Sitzungen nicht. Nur `user.token_version` beendet alle Sitzungen eines Nutzers; "überall abmelden" gibt es nicht. Bräuchte eine Token-Tabelle. |
| niedrig–mittel | **Tokens im Query** | SSO leitet auf `/auth/callback?token=…&refresh_token=…`: Tokens landen in Browser-Verlauf und ggf. Server-Logs des Frontend-Hosts (Referrer nur, falls die Callback-Seite externe Ressourcen lädt). Fragment (`#token=…`) wäre besser (Frontend + Backend). |
| niedrig–mittel | **Karten-Bilder privater Termine/Orte** | `GET /api/map/image/event/{id}` liefert das Kartenbild auch für veröffentlichte Termine, die nur in privaten Feeds stehen, `GET /api/map/image/location/{id}` für jeden Ort (jeweils nur mit bekannter UUID; Entwürfe antworten 404). Eine Prüfung bräuchte einen Feed-/Geheimnis-Bezug. Der Event-Endpoint wird von Frontend und Mails derzeit nicht genutzt. |
| niedrig | **ID-Token-Claims ungeprüft** | `OidcProvider` prüft beim ID-Token weder Signatur noch `aud`/`iss`/`exp`. Das Token kommt direkt vom Token-Endpoint über TLS (nach OIDC zulässig), im Code-Flow mit Client-Secret nicht ausnutzbar; `iss` ist bei Microsoft `common` mandantenabhängig, daher kein trivialer Fix. |
| niedrig | **Microsoft-Konto blockiert Registrierung** | Ein per Microsoft angelegtes unbestätigtes Konto mit fremder Adresse blockiert dauerhaft die lokale Registrierung des Eigentümers (`Email already in use`; `app:prune-unverified-users` löscht SSO-Konten nicht). Erst ein Google-/Apple-Login mit bestätigter Adresse löst das. |
| niedrig | **Passwort-Hashing** | `App\Entity\User` nutzt explizit `bcrypt` (Kosten 13) statt `auto`. Seit Paket 3 überall 8–128 Zeichen (`PasswordPolicy`); bcrypt liest 72 Bytes, Symfony hasht längere Passwörter vorab (SHA-512). Umstellung auf `auto` (argon2id) mit Rehash bei Anmeldung möglich. |
| niedrig | **User-Verification optional** | `WEBAUTHN_USER_VERIFICATION=preferred` (Standard) lässt Passkeys ohne PIN/Biometrie (nur Besitz) zu; `required` ist strenger, schließt aber Sicherheitsschlüssel ohne PIN aus. |
| Betrieb | **Platzhalter-Geheimnisse** | `APP_SECRET` (signiert Challenges und OAuth-State) und `JWT_REFRESH_SECRET` haben in `.env` Platzhalter; in Produktion müssen sie gesetzt sein (siehe "Betrieb"). |
| Hinweis | **Konto-Enumeration Mitglieder** | `POST …/members` 404 "User not found" verrät, ob ein Konto existiert (vom Design gewollt). |

## Behobene Bugs (Backend)

Alle mit Tests; Details in den Commits.

- **`b6537e7`** – Termin/Vorlage mit unveränderten Zuordnungen ändern lief in `EntityIdentityCollisionException`
  (500), weil alle Verknüpfungen gelöscht und im selben Flush neu angelegt wurden (Bearbeiten mit Zielgruppe schlug
  immer fehl). Jetzt nur Differenz (`App\Service\LinkCollectionSync`); PATCH-Antworten liefern Listen statt
  Objekten (`getValues()`). Tests `EventTest::testUpdateKeepsUnchangedAndSyncsChangedAssignments`,
  `ResourcesTest::testTemplateUpdateKeepsUnchangedAndSyncsChangedAssignments`.
- **Phase 7** – `GET /api/auth/me` antwortete nach dem Registrieren eines Passkeys mit 500 (Blob als Stream
  hydriert, Property `string`). `Passkey` liest den Stream; Test `AuthTest::testMeListsPasskeysOfAUserLoadedFromTheDatabase`.
- **`eaa9831`** – ICS: mehrtägige Ganztagstermine hatten `DTEND` einen Tag zu spät
  (`PublicTest::testIcsWritesExclusiveEndForMultiDayAllDayEvent`); `?targetGroupIds=` am öffentlichen Feed konnte die
  Zielgruppen-Einschränkung des Feeds erweitern, jetzt Schnittmenge (`PublicTest::testFeedTargetGroupsCannotBeWidenedByQuery`).
- **`7b218c2`** – Bugfix-Runde Backend:
  - Doppelte IDs in Zuordnungen (Termin/Vorlage/Import/`from-template`/Feeds) → 500; jetzt dedupliziert, Antworten von
    `POST …/events` und `POST …/feeds` enthalten die Zuordnungen direkt (`InputIntegrityTest::testCreate*WithDuplicateAssignmentIds` u. a.).
  - Mandantentrennung: Ort, Vorlage, Eigenschaften, Features, Zielgruppen müssen zum Kalender gehören
    (`App\Service\CalendarReferences`); unbekannte und fremde IDs → 422 `<feld>: unknown id "…" in this calendar`.
    **Verhaltensänderung:** vorher wurden unbekannte IDs beim Termin-PATCH ignoriert und fremde bei Vorlage/Feed
    verworfen. Frontend-Folge: veraltete Formulare laden bei 422 neu und speichern einmal erneut
    (`src/lib/staleReferences.ts`, E2E `stale-assignments.spec.ts`).
  - Eingabeprüfung (400 statt 500) für Pflichtfelder/Formate von Termin, Import (`events[n]: …`, nichts wird
    gespeichert), Vorlage, Namen, Ortstexte.
  - Zeitzonen nur gültige IANA-Namen (inkl. Alt-Aliasse), sonst 422; `IcsService` fällt bei gespeicherten
    ungültigen Namen auf Kalender-, Vereins-, dann UTC-Zone zurück, ungültige Uhrzeit → Ganztagstermin. Das
    Onboarding sendet `Etc/Unknown` nicht mehr.
  - ICS mit `VTIMEZONE` je genutzter TZID (RFC 5545; strenge Clients lasen Zeiten sonst als schwebend).
  - Überlappungsfilter für `…/events?from&to` (`EventTest::testDateRangeIncludesMultiDayEventsOverlappingTheRange`);
    `holiday-events` filterte bereits auf Überlappung (`HolidayCalendarTest::testListHolidayEventsIncludesHolidaysOverlappingTheRange`).
  - Privater Feed eines archivierten Kalenders verriet den Archivstatus (404 vor 403); jetzt erst Geheimnis, dann
    Archiv (`PublicTest::testArchivedPrivateFeedRequiresSecretBeforeRevealingArchiveState`).
  - CORS-Header fehlten bei 404 aus `#[MapEntity]` (Fehler in `symfony/http-kernel` 8.1.0, Update auf 8.1.1); `detail`
    von Framework-Fehlern ohne Klassennamen/URLs (`ErrorResponseTest`).
  - `PATCH …/feeds/{id}` lieferte `targetGroups` als Objekt statt Liste.
  - Kartenbild `GET /api/map/image/event/{id}` lieferte Orte von Entwürfen (jetzt 404).
  - Mapbox-Proxy: Punkt-Segmente (`../`, `%2e%2e`) führten mit dem Server-Token zu beliebigen Mapbox-APIs (jetzt 403,
    `MapboxProxyServiceTest::testRejectsDotSegmentsAndBackslashesInPath`).
  - SSRF Feiertagskalender: IPv6-Hosts in Klammern und Weiterleitungen wurden nicht geprüft; jetzt
    `NoPrivateNetworkHttpClient` (`Unit\HolidayCalendarServiceTest`).
  - `composer audit`: `guzzlehttp/guzzle` 7.12.3 → 7.15.5 (nur `composer.lock`), ohne Befund.
- **`fe1dc8c`** – Sicherheit Authentifizierung:
  - **Passkeys (kritisch):** `verifyAuthentication` prüfte weder Signatur noch authenticatorData, die Registrierung
    speicherte das rohe attestationObject. Jetzt vollständige Prüfung mit `web-auth/webauthn-lib`: Server-Challenge im
    `challengeToken` (HMAC aus `APP_SECRET`, zweckgebunden, 5 Minuten, bei Registrierung an den Nutzer gebunden),
    einmalig über Tabelle `auth_nonce` (eindeutiger Index, Vergleich in UTC); geprüft werden `clientDataJSON` (Typ,
    Challenge, Origin exakt = serialisierte Origin von `FRONTEND_URL`, `crossOrigin: true` abgelehnt), rpIdHash
    (`WEBAUTHN_RP_ID`), User-Present, User-Verified nur bei `required`, Signatur, Signaturzähler (Rückschritt = Klon),
    userHandle, Attestation (`none`, `packed`), eindeutige Credential-ID. Einheitlich 401 `Invalid passkey`, kaputte
    Anfragen 400. COSE-Schlüssel gespeichert, Alt-Einträge werden bei der ersten Anmeldung umgeschrieben. Tests
    `tests/Controller/WebAuthnTest.php`, E2E `profile.spec.ts` (inkl. Replay → 401).
  - **OAuth-State:** signierter, providergebundener, einmaliger `state` (10 Minuten) + gleiche Nonce im Cookie
    `oauth_state_nonce` (HttpOnly, Secure, SameSite=None wegen Apples form_post, Pfad `/api/auth/oauth`, nur API-Host)
    gegen Login-CSRF. Fehler als Codes in `?error=`.
  - **Konto-Verknüpfung per E-Mail:** bekanntes Provider-Konto (Provider + `sub`) meldet an; sonst nur bei
    vertrauenswürdigem `email_verified` (Google, Apple; `AuthService::PROVIDERS_WITH_VERIFIED_EMAIL_CLAIM`).
    Microsoft verknüpft nie automatisch (bestehende Adresse → `account_exists`, sonst neues unbestätigtes Konto).
    Verifizierter Login auf ein nie bestätigtes Konto übernimmt es mit Bereinigung (Passwort, Passkeys, andere
    SSO-Verknüpfungen, offene Bestätigungslinks). Verknüpft wird nur bei bis auf ASCII-Groß/Kleinschreibung
    identischer Adresse (Kollation `utf8mb4_unicode_ci` setzt `ä`=`a`, `ß`=`ss` gleich). Neue SSO-Nutzer gelten nur
    als bestätigt, wenn der Provider es bestätigt; `app:prune-unverified-users` löscht SSO-Konten nicht mehr. Tests
    `tests/Controller/OAuthTest.php`.
- **`9cc6f10`** – Sitzungen nach Entzug von Zugangsdaten (hoch): Die SSO-Übernahme ließ bestehende Sitzungen des
  Angreifers leben (Refresh gab unbegrenzt neue Tokens). Jetzt `user.token_version` (Migration
  `Version20261004130000`), Claims `tv` + `uid` in Access- und Refresh-Token, geprüft beim Refresh
  (`AuthService::refresh`) und bei jeder JWT-Anmeldung (`App\Security\SessionVersionListener`). Erhöht bei
  SSO-Übernahme und bei der ersten Bestätigung der Adresse per Link (dabei werden auch SSO-Verknüpfungen und Passkeys
  aus der unbestätigten Zeit entfernt, das Passwort bleibt). Alt-Tokens ohne Claims zählen als Version 0. Ein
  Access-Token eines gelöschten Kontos öffnet kein neu registriertes Konto mit derselben Adresse (`uid`). Passkey
  entfernen erhöht die Version nicht. Frontend: 401 → ein Refresh → 401 → Tokens löschen, `/login`, ohne
  Rückfrage zu ungespeicherten Änderungen (`src/lib/sessionEnd.ts`). Tests
  `tests/Controller/SessionInvalidationTest.php`, E2E `e2e/session-revoked.spec.ts`.
  Folge für Microsoft-Nutzer, die ihre Adresse per Link bestätigen (nur über `resend-verification` erreichbar):
  Microsoft-Login und Passkeys sind danach weg.

## Betrieb

- **Migrationen** auf Dev und Prod ausführen (`npm run migrate`; Deploy macht es automatisch):
  `Version20261004120000` (Tabelle `auth_nonce` für einmalige Passkey-Challenges/OAuth-States),
  `Version20261004130000` (`user.token_version`, Standard 0), `Version20261009120000` (Vorlagen-Zeiten nullable),
  `Version20261010120000` (`event.external_uid`) und `Version20261013120000` (Paket 3: `password_reset`,
  `email_change`, `passkey.last_used_at`, `club_user.last_calendar_id`).
- **Cron:** `php bin/console app:prune-password-resets` (z. B. täglich) löscht abgelaufene Reset-Links und
  E-Mail-Wechsel; wie bisher `app:prune-unverified-users`.
- **Mail-Templates:** nach Änderungen an `templates/email/*.mjml` `npm run build:mail -w backend` (die kompilierten
  `*.html.twig` sind eingecheckt; `npm run build` baut sie ebenfalls).
- **`BACKEND_URL`** muss die öffentliche API-Adresse sein: Bestätigungslink der neuen E-Mail-Adresse und der
  SSO-Link-Start (`link-start` → `{BACKEND_URL}/api/auth/oauth/{provider}/link?ticket=…`) bauen darauf auf.
- **Rate-Limit je IP** (`password_reset_ip`) nutzt `Request::getClientIp()`: hinter einem Reverse Proxy, der die
  Client-Adresse nicht als `REMOTE_ADDR` weitergibt, `framework.trusted_proxies` setzen, sonst teilen sich alle
  Nutzer einen Zähler (20 Anfragen je Stunde; darüber weiterhin 204, aber ohne Mail).
- **Support:** `app:user:verify <email>` bestätigt eine Adresse, `app:user:reset-link <email>` gibt einen Reset-Link
  aus (nur CLI; die URL ist 60 Minuten gültig und gewährt den Zugang zum Konto, nur an den Eigentümer geben).
- **Umgebungsvariablen (Produktion):**
  - `APP_SECRET` und `JWT_REFRESH_SECRET` müssen gesetzt sein (in `.env` stehen Platzhalter); `APP_SECRET` signiert
    Passkey-Challenges und OAuth-State, ein Wechsel macht laufende Anmeldevorgänge ungültig.
  - `WEBAUTHN_RP_ID` (Domain des Frontends), `WEBAUTHN_RP_NAME`, optional `WEBAUTHN_USER_VERIFICATION`
    (`preferred` Standard, `required` strenger). Erlaubte Origin ist `FRONTEND_URL` (exakt).
- **HTTPS für SSO:** Das State-Cookie ist `Secure; SameSite=None`. Chrome/Firefox akzeptieren es auf
  `http://localhost`, Safari nicht zuverlässig; lokales SSO daher mit HTTPS (Symfony CLI/Herd) oder Chrome/Firefox.
- **Webserver:** optional HTTP-Header `Referrer-Policy: no-referrer` und `X-Robots-Tag: noindex` für `/feed/*`
  (die SPA setzt nur `<meta>`).
- **Nach einem Deploy** fehlen die Chunks des vorigen Releases; das Frontend lädt bei einem fehlgeschlagenen
  Chunk-Import einmal neu (`vite:preloadError` in `frontend/src/main.tsx`).
