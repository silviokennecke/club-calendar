# Backend-Lücken und offene Risiken (Endstand)

Stand: 2026-10-15, nach Paket 5 (Serienregel ändern, RRULE-Import, Hinweis-Mails) und den drei Feed-Status. Der Umsetzungsplan (`BACKEND-PLAN.md`, Pakete 1–4) ist abgeschlossen. Hier steht,
was nach dem Redesign im Backend noch fehlt (jeder Punkt am 2026-10-13 gegen den Code geprüft), welche
Sicherheitsrisiken offen sind, was umgesetzt und behoben wurde und was im Betrieb zu tun ist. Zuordnung zu den
Artboards: `COVERAGE.md`; Redesign-Plan: `PLAN.md`; E2E-Umgebung: `E2E.md`.

## Kurzfassung

1. **Alle Design-Features haben ein Backend.** Keine Aktion ist mehr "Bald verfügbar": Zähler und Einzel-Endpoints
   (Paket 1), Import-Vorschau, atomarer Import, Export, Sammelaktionen, Fehlercodes (Paket 2), Passwort vergessen,
   Profil, SSO verknüpfen/trennen (Paket 3), Terminserien mit "nur dieser Termin / alle Termine der Reihe" (Paket 4),
   Serienregel nachträglich ändern, RRULE-Auflösung beim Import und Hinweis-Mails bei Konto-Änderungen (Paket 5).
2. **Vor produktiver Nutzung (Betrieb):** alle Migrationen ausführen (zuletzt `Version20261015120000`, Feed-Status:
   bestehende öffentliche Feeds werden vereinsintern, private bleiben privat),
   `APP_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL` (bzw. `FRONTEND_URL`/`BACKEND_URL`) und `WEBAUTHN_*` setzen, Crons
   einrichten, SSO nur über HTTPS. Siehe "Betrieb".
3. **Sicherheit:** die bekannten Risiken (Rollen, Rate-Limiting, Refresh-Rotation, Tokens im Redirect, Enumeration,
   ...) stehen im Security-Audit des Auftraggebers; hier nur der Verweis und drei kleine Restpunkte.
4. **Offen (klein, kein Design-Bedarf):** kurze Feed-Adressen (Slugs), Zustand "Kalender archiviert" im öffentlichen
   Feed, Rollen/Rechte. Liste unten.

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
- **Geheimnis** wird für jeden Feed erzeugt und ausgeliefert, auch für öffentliche und vereinsinterne (nur bei
  privaten relevant). Beim Wechsel von Privat zu Öffentlich/Vereinsintern bleibt es unverändert; beim Wechsel von
  Öffentlich/Vereinsintern zurück zu Privat erzeugt `FeedService::update()` immer ein **neues** Geheimnis (das alte
  kann in der offenen Phase in geteilten Links, Logs oder dem Browserverlauf gelandet sein und darf nicht wieder
  Zugriff geben); die Feedliste zeigt danach die neuen Adressen.
- **Archiviert vs. unbekannt:** beide 404 ohne Code; ein Zustand "Kalender archiviert" bräuchte einen eigenen
  Status/Code. Falsches und fehlendes Geheimnis sind nicht unterscheidbar (für Gäste gewollt).
- **Indexierung:** gesteuert je Feed (Status `PUBLIC` + Option `searchable`, siehe "Feed-Status"). Die SPA-Seiten
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
- **CSV-Export** ist weder im Design noch gebaut.

### Listen und Mitglieder

- **Doppelte Namen** von Eigenschaften/Features/Zielgruppen aus der Zeit vor Paket 1 bleiben erhalten; es gibt keinen
  Unique-Index (die Prüfung ist eine Komfortprüfung, gleichzeitige Anlagen können beide durchgehen).
- **Rollen:** keine (jedes Mitglied darf alles, auch den Verein löschen; siehe Security-Audit).
- `POST …/members` für eine bereits eingetragene Person legt nichts an und antwortet trotzdem erfolgreich (das
  Frontend prüft Duplikate lokal).
- `PATCH /api/clubs/{id}` kann die Zeitzone ändern; das Design zeigt sie nur im Seitenkopf, daher kein UI-Feld.

### Dokumentation

- Keine API-Referenz (OpenAPI); das Frontend leitet Typen von Hand ab (`frontend/src/lib/types.ts`). Die Codes stehen
  unten unter "Fehlercodes".
- Kein eigener E2E-Seed außer den Fixtures (die Suite bestätigt Nutzer mit `app:user:verify` und holt Reset-Links mit
  `app:user:reset-link`).

## Offene Sicherheitsrisiken

**Siehe Security-Audit** (Bericht des Auftraggebers, nicht im Repository): Rollen/Einladungen/letzter Admin,
Vorab-Registrierung mit fremder Adresse (Pre-Hijacking, nachgestellt in
`SessionInvalidationTest::testPreRegisteredPasswordStillWorksAfterTheOwnerConfirms`), Mapbox-Proxy,
Microsoft-SSO ohne vertrauenswürdiges `email_verified` (inkl. "unbestätigtes Microsoft-Konto blockiert die
Registrierung"), Rate-Limiting für Login/Token/Passkey/OAuth-Callback, Host-Header, ICS-Injection, CSP/Header, Tokens
im SSO-Redirect, Refresh-Tokens ohne Rotation/Widerruf, Quoten und unbegrenzte ID-Listen, Konto-Enumeration
(`POST …/members` 404), Kartenbilder privater Termine/Orte, CORS-Regex, Geheimnisse/Deploy.

Nicht im Audit, gering:

| Schweregrad | Risiko | Details / mögliche Behebung |
| --- | --- | --- |
| niedrig | **ID-Token-Claims ungeprüft** | `OidcProvider` prüft beim ID-Token weder Signatur noch `aud`/`iss`/`exp`. Das Token kommt direkt vom Token-Endpoint über TLS (nach OIDC zulässig), im Code-Flow mit Client-Secret nicht ausnutzbar; `iss` ist bei Microsoft `common` mandantenabhängig. |
| niedrig | **Passwort-Hashing** | `App\Entity\User` nutzt explizit `bcrypt` (Kosten 13) statt `auto`; 8–128 Zeichen (`PasswordPolicy`), Symfony hasht Passwörter über 72 Bytes vorab. Umstellung auf `auto` (argon2id) mit Rehash bei Anmeldung möglich. |
| niedrig | **User-Verification optional** | `WEBAUTHN_USER_VERIFICATION=preferred` (Standard) lässt Passkeys ohne PIN/Biometrie zu; `required` ist strenger, schließt aber Sicherheitsschlüssel ohne PIN aus. |

## Umgesetzt (Paket 1–5)

Neue Felder sind jeweils Ergänzungen; bestehende Antwortformen blieben gleich. Tests je Feature in
`backend/tests/Controller` (rot ohne Umsetzung geprüft), Frontend mit Vitest und Playwright.

### Feed-Status: öffentlich, vereinsintern, privat (2026-10-15)

Migration `Version20261015120000`. **Entscheidungen des Auftraggebers:**

- **Drei Status** (`App\Enum\FeedVisibility`): `PUBLIC` ("Öffentlich"), `CLUB` ("Vereinsintern", **Standard für neue
  Feeds**, auch in der API: `POST …/feeds` ohne `visibility` legt `CLUB` an) und `PRIVATE` ("Privat (geschützt)").
  `PUBLIC` und `CLUB` sind technisch gleich (Webansicht, ICS, Einzeltermin, Feiertage ohne Geheimnis per Link, wie
  bisher "öffentlich"; ein mitgeschicktes Geheimnis wird ignoriert); der **einzige Unterschied ist die
  Suchmaschinen-Anweisung**. `PRIVATE` verlangt weiter das Geheimnis (403 ohne/mit falschem, Geheimnisprüfung vor
  allem anderen, kein Orakel; archivierter Kalender 404, bei Privat erst mit Geheimnis: unverändert).
- **Suchmaschinen-Option** `searchable` (bool, Spalte `calendar_feed.searchable`, Standard `false` = Opt-in), nur bei
  `PUBLIC`. **Indexierbar genau dann, wenn `visibility = PUBLIC` und `searchable = true`**
  (`CalendarFeed::isIndexable()`); sonst immer noindex (CLUB, PRIVATE, PUBLIC ohne Option, alle Fehlerantworten).
  API: `searchable: true` bei einem anderen (resultierenden) Status → 422 `validation_failed` field `searchable`
  (nichts gespeichert); kein Boolean → 400 field `searchable`. Ein `PATCH` weg von `PUBLIC` setzt `searchable`
  automatisch auf `false` (auch zurück zu `PUBLIC` bleibt es aus, bis es wieder gesetzt wird). Antworten von
  `GET/POST/PATCH …/feeds` liefern immer den wirksamen Wert `searchable` und zusätzlich `indexable`. Ungültige
  `visibility` → 400 `validation_failed` field `visibility` (vorher 400 ohne Code).
- **Öffentliche API:** `GET /api/feed/{id}/events` und `…/events/{eventId}` liefern in `feed` `visibility`
  (`PUBLIC|CLUB|PRIVATE`, vorher `PUBLIC|PRIVATE`) und neu `indexable` (bool). Frontend-Typ `FeedVisibility`
  (`lib/types.ts`) angepasst.
- **Robots-Header nur im Backend** (der Webserver setzt kein `X-Robots-Tag`): `FeedResponseHeadersListener::robotsTag()`
  sendet `noindex`, außer die Antwort ist erfolgreich (2xx) UND das Request-Attribut `feed_indexable` ist `true`.
  Das Attribut setzt `PublicFeedService::loadFeed()` nach den Zugriffsprüfungen (der Listener lädt den Feed nicht noch
  einmal); fehlt es (unbekannter Feed, 403, 404, archiviert) oder folgt ein Fehler (400 bei ungültigem `from`, 404
  für einen unbekannten Termin) → `noindex`. Antworten indexierbarer Feeds haben keinen `X-Robots-Tag`.
  `Referrer-Policy: no-referrer` bleibt unverändert für alle `/api/feed/*`. Symfonys eigenes noindex im Debug-Modus
  (`framework.disallow_search_engine_index`) ist abgeschaltet, damit Dev/Test sich wie Prod verhalten.
- **Migration und Bestandsdaten:** `calendar_feed.visibility` ist ein `VARCHAR(255)` (Doctrine-`enumType`, kein
  DB-ENUM), daher keine Typänderung. `up`: Spalte `searchable TINYINT(1) NOT NULL DEFAULT 0`, Spalten-Default von
  `visibility` `'PRIVATE'` → `'CLUB'`, **bestehende `PUBLIC`-Feeds → `CLUB`** (weiter per Link erreichbar, jetzt
  nicht indexiert). **Bestehende `PRIVATE`-Feeds BLEIBEN `PRIVATE`**: die Vorgabe "bestehende werden vereinsintern"
  bezieht sich nur auf die bisher öffentlichen Feeds, ein privater Feed verliert sein Geheimnis nie durch die
  Migration. `down`: `CLUB` → `PUBLIC`, Default zurück auf `'PRIVATE'`, `searchable` entfernt (die Option geht
  verloren). Geheimnisse bleiben unverändert. `CLUB` → `PUBLIC` öffnet beim Zurückrollen nichts: beide sind ohne
  Geheimnis erreichbar, und der alte Code sendet für jeden Feed `noindex`; ein Mapping `CLUB` → `PRIVATE` würde
  dagegen Abonnenten aussperren, die nie ein Geheimnis bekommen haben.
- **Kalender duplizieren** kopiert Feeds weiterhin mit gleichem Status und neuen Geheimnissen; `searchable` ist in der
  Kopie immer `false` (keine zweite indexierte Kopie derselben Termine).
- **Fixtures:** "Öffentlicher Kalender" (`PUBLIC`), neu "Vereinskalender" (`CLUB`), "Privater Kalender" (`PRIVATE`).
- **Frontend:** `FeedEditPage` Radiogruppe mit drei Status (Standard Vereinsintern; der Erklärtext sagt "Kein
  Zugriffsschutz: Jeder mit dem Link …, auch Nicht-Mitglieder", denn "vereinsintern" ist nur eine Bitte an
  Suchmaschinen, keine Zugriffsbeschränkung), Schalter "Für Suchmaschinen auffindbar" nur bei Öffentlich (wird beim
  Verlassen von Öffentlich im Formular ausgeschaltet: ausdrückliches Opt-in), Bestätigung (`ConfirmDialog`) beim Speichern eines privaten Feeds als
  öffentlich/vereinsintern; `FeedsPage` Badges `public`/`club`/`private` + `searchable` ("Auffindbar");
  `usePublicHead({indexable})` setzt `<meta name="robots" content="noindex, nofollow">`, außer `feed.indexable ===
  true` (Abweichungen vom Design: `COVERAGE.md`, "Feed-Status").
- **Tests:** `FeedStatusTest` (Zugriffsmatrix PUBLIC / PUBLIC+searchable / CLUB / PRIVATE × ohne / richtiges /
  falsches Geheimnis × Terminliste, Einzeltermin, ICS, Feiertage mit from/to; Archiv 404 und Geheimnis zuerst;
  Robots-Matrix an echten Antworten inkl. 400/403/404; Defaults und Validierung von `searchable`; Mandanten- und
  Archivregeln der Feed-Routen; Duplizieren; Wechsel wirkt sofort, zurück zu Privat mit neuem Geheimnis; ungültige
  `visibility`-/`searchable`-Werte), `FeedStatusMigrationTest` (up/down mit Bestandsdaten: vormals
  öffentlicher Feed ohne Geheimnis erreichbar, vormals privater verlangt es weiter), `Unit/FeedResponseHeadersListenerTest`
  (Matrix Attribut × Status); Vitest `lib/feeds`, `FeedEditPage`, `FeedsPage`, `FeedPage` (Robots-Meta je Status),
  `components/feed/__tests__/usePublicHead.test.tsx`; E2E `feeds.spec.ts` (Anlegen je Status, Suchoption, Badges,
  Wechsel Privat → Vereinsintern mit Bestätigung), `public.spec.ts` (Meta und `X-Robots-Tag` je Status). Jede
  Regel per Mutation gegengeprüft (ohne Umsetzung rot).

### Header der Feed-Adressen (2026-10-15)

Keine Migration. (Robots-Steuerung je Feed seit "Feed-Status", oben.) `Referrer-Policy: no-referrer` für `/feed/*` (SPA) und `/api/feed/*`: Apache
(`backend/public/.htaccess`, `<If>` auf `THE_REQUEST`, wirkt auch auf die per Rewrite ausgelieferte `index.html`),
Caddy (`docker/Caddyfile`, `@feed`; die allgemeine Policy dort ist ein Default `?Referrer-Policy`) und im Backend
für `/api/feed/*` (`FeedResponseHeadersListener`, auch Fehlerantworten). `X-Robots-Tag: noindex` setzt NUR das
Backend für die Feed-API (selber Listener, `robotsTag()` ist die zentrale Stelle für eine spätere Steuerung nach
Feed-Status); der Webserver setzt ihn nicht. Tests `PublicTest::testFeedApiResponsesSendNoReferrerAndNoindex`,
`Unit/FeedResponseHeadersListenerTest`; Header gegen Apache 2.4 und Caddy 2 mit curl geprüft.

### Paket 5: Serienregel ändern, RRULE-Import, Hinweis-Mails (2026-10-14)

Keine Migration. Tests `EventSeriesRuleChangeTest` (18 Fälle, darunter der Sperr-Test mit zweiter DB-Verbindung: hält eine andere Verbindung die Serienzeile, endet das PATCH nach dem Lock-Timeout mit 409 `series_changed` und ändert nichts; ohne `FOR UPDATE` rot), `NoticeMailTest` (11), angepasst `AccountTest`;
Vitest `lib/import/__tests__/rrule.test.ts`, `EventSeriesEditModal.test.tsx`, `ImportPage.test.tsx`; E2E
`series-change.spec.ts`, `import-rrule.spec.ts`.

**Serienregel nachträglich ändern** (`EventSeriesService::previewUpdate` / `update`, `SeriesRule` bleibt die einzige
Datumsberechnung):

- `POST /api/calendars/{id}/event-series/{seriesId}/preview-update {rule}` → `{toCreate: [{date}], toDelete: [{id,
  date, name, isDraft}], kept, past, skippedHolidays: [{date, name}]}`; schreibt nichts.
- `PATCH /api/calendars/{id}/event-series/{seriesId} {rule}` → `{series, created, deleted, kept}` (Zahlen; `series`
  wie `GET …/event-series/{id}` mit der neuen Regel und `eventCount`).
- **Semantik (Entscheidungen des Auftraggebers):** nur KÜNFTIGE Termine (Datum ≥ heute in der Kalenderzone, sonst
  Vereinszone; Uhr `ClockInterface`) werden angefasst, vergangene bleiben unverändert in der Serie. Die neue Regel
  ergibt ihre vollständige Datumsmenge ab `startDate` (`count`/`until` zählen über die ganze Serie, Daten vor heute
  werden ignoriert). Künftige Termine auf einem Datum der Menge bleiben unverändert (auch einzeln bearbeitete),
  fehlende Daten werden neu angelegt mit den Werten des **Prototyps** (frühester künftiger Termin der Serie, sonst der
  späteste vorhandene: Name, Zeiten, Zeitzone, Ganztägig, Status, Ort, Vorlage, Eigenschaften, Features,
  Zielgruppen, Dauer `dateEnd − date`), künftige Termine auf anderen Daten werden gelöscht (die Vorschau listet sie
  einzeln). `durationDays` der Regel bleibt der der Serie (Feiertags-Überlappung).
- **Grenzen/Fehler:** Mitglied (403), nicht archiviert (403), Serie eines anderen Kalenders/unbekannt 404, Validierung
  wie beim Anlegen (400 `validation_failed` `rule.*`), kaputtes JSON 400 `invalid_request`, mehr als 366 Termine je
  Serie NACH der Änderung (vergangene + bleibende + neue) oder eine Regel mit mehr als 366 Daten 422
  `too_many_events`, eine Serie ohne Termine danach 422 `validation_failed` field `rule`, eine Serie ohne Termine
  (Prototyp fehlt) 409 `series_empty`, Prototyp oder eine seiner Referenzen gleichzeitig gelöscht / Deadlock 409
  `series_changed`.
- **Atomar:** eine Transaktion mit `SELECT … FOR UPDATE` auf der Serienzeile (zwei Änderungen derselben Serie laufen
  nacheinander, die zweite rechnet mit dem Ergebnis der ersten); Löschen per DQL `id IN (…) AND series = …` (parallel
  gelöschte Termine sind kein Fehler), neue Termine ohne Lesezugriffe aus dem Prototyp kopiert. Nachweise:
  erzwungener DB-Fehler (Trigger) ändert nichts, Abfragezahl 4 vs. 13 neue Termine unterscheidet sich nur um die
  INSERTs.
- **Frontend:** Aktion "Reihe ändern" am Hinweis "Teil einer Terminreihe" (nicht im Archiv) → Schritt
  `…/events/:eventId/series` (`EventSeriesEditModal`, Regel-Formular `SeriesRuleFields`, Vorschau
  `useSeriesUpdatePreview` entprellt, Bestätigung per `ConfirmDialog`), Wortlaut eigen (COVERAGE.md).

**RRULE beim ICS-Import** (Browser, `frontend/src/lib/import/rrule.ts` + `ics.ts`; die Backend-API bleibt, sie
bekommt einzelne Termine):

- **Teilmenge:** FREQ=DAILY|WEEKLY|MONTHLY|YEARLY mit INTERVAL, COUNT, UNTIL (Datum oder Datum-Zeit, UTC oder
  floating), BYDAY (wöchentlich mehrere Tage; monatlich und jährlich mit BYMONTH n-ter/letzter Wochentag wie `2MO`,
  `-1FR` oder jeder solche Wochentag), BYMONTHDAY (auch negativ), BYMONTH, WKST (Wochenbeginn für WEEKLY mit
  INTERVAL > 1, Standard Montag; wird beachtet), EXDATE (mehrere Zeilen/Werte, DATE, TZID, UTC), RDATE (auch PERIOD:
  Beginn), RECURRENCE-ID (ersetzt die Instanz am Datum statt sie doppelt zu importieren; ohne Hauptereignis ein
  Einzeltermin). DTSTART ist immer die erste Instanz und zählt für COUNT (wie ical.js). UNTIL ist inklusiv, auch
  minutengenau (eine Instanz genau zur UNTIL-Zeit gehört dazu); ein UNTIL als Datum bei einer DTSTART mit Uhrzeit
  (nach RFC eigentlich unzulässig) schließt den ganzen Tag ein. Ungültige Daten (31., 29.02.) entfallen nach RFC 5545
  (ical.js verschiebt den 29.02. bei YEARLY auf den 01.03.; hier bewusst RFC). Abgleich (Fuzz, 3000 Regeln) mit
  ical.js 2, rrule.js und einer unabhängigen Tagesreferenz: Abweichungen nur dort, wo ical.js von RFC 5545 abweicht
  (negatives BYMONTHDAY, MONTHLY mit BYMONTH und INTERVAL, YEARLY mit BYMONTHDAY ohne BYMONTH, doppelt gezählte
  Instanzen, ausgelassene DTSTART/EXDATE, verschobene ungültige Daten).
- **Nicht unterstützt** (BYSETPOS, BYHOUR, BYMINUTE, BYSECOND, BYWEEKNO, BYYEARDAY, SECONDLY/MINUTELY/HOURLY, n-ter
  Wochentag im Jahr ohne BYMONTH, RSCALE, SKIP) und kaputte Regeln: nur der erste Termin, Warnung "Wiederholung wird
  nicht unterstützt: nur der erste Termin wird importiert." (kein stilles Verwerfen, kein Absturz).
- **Grenzen:** je Regel höchstens 366 Instanzen (`MAX_INSTANCES_PER_RULE`, nach EXDATE), Regeln ohne Ende: zwei Jahre
  ab dem ersten Termin oder 366, je Datei höchstens 5000 Termine (`IMPORT_MAX` = Backend `EventImportService::MAX_EVENTS`;
  spätere Instanzen weichen, erste Instanzen und Einzeltermine bleiben); jede Kappung als Warnung mit Zahlen.
- **Zeiten:** Datumsarithmetik in Kalendertagen; Wanduhrzeit einer TZID- oder floating-DTSTART bleibt über
  Sommer-/Winterzeit gleich; UTC-DTSTART wird nach RFC 5545 in UTC iteriert und je Instanz in die Kalenderzone
  umgerechnet (die Wanduhrzeit verschiebt sich mit der Sommerzeit, Test). Ganztägig/mehrtägig: Dauer bleibt. EXDATE/
  RECURRENCE-ID/UNTIL werden in die Darstellung der DTSTART umgerechnet. Am Umstellungstag bleibt eine nicht
  existierende Wanduhrzeit (02:30 Ende März) als 02:30 mit Zone gespeichert (Kalender-Apps zeigen sie nach RFC 5545
  als 03:30), eine doppelte (Ende Oktober) als die Uhrzeit, wie sie in der Datei steht.
- **Duplikate:** `externalUid` je Instanz = `${UID}#${YYYYMMDD}` (Datum der Instanz, wie sie angelegt wird: UTC-Zeiten
  in der Kalenderzone, TZID-Zeiten in ihrer Zone; eine UID über 246 Zeichen wird auf 237 Zeichen + `~` + Hash der ganzen UID
  gekürzt, damit 255 reichen und zwei lange UIDs mit gleichem Anfang verschieden bleiben). Vorschau und
  Backend erkennen so jede Instanz; ein Wiederimport mit `skipDuplicates` legt nichts neu an (E2E).
- **Prüfansicht:** Hinweis "Wiederholungen ausgeschrieben" (als Einzeltermine, nicht als Terminreihe), Gruppen bleiben
  nach Name; Gruppenkopf "Wiederholung (n Termine)", je Eintrag "aus Wiederholung".

**Hinweis-Mails** (`AccountMailer::sendPasswordChanged` / `sendEmailChangeRequested` / `sendEmailChanged`, Vorlagen
`password_changed.mjml`, `email_change_requested.mjml`, `email_changed.mjml`, de/en nach `user.language`):

- `POST …/change-password` und Abschluss von `POST …/reset-password` → "Dein Passwort wurde geändert" an die Adresse
  des Kontos; `POST …/change-email` → "Es wurde eine Änderung deiner E-Mail-Adresse angefordert" an die BISHERIGE
  Adresse (neue Adresse maskiert `m***@beispiel.de`, auch wenn die neue Adresse vergeben ist; über dem Rate-Limit
  keine Mail); Bestätigungslink `GET …/verify-new-email` erfolgreich → "Deine E-Mail-Adresse wurde geändert" an die
  ALTE Adresse (neue maskiert).
- Inhalt: was passiert ist, wann (UTC und, falls bekannt, Zone des letzten Kalenders/Vereins des Nutzers), was zu tun
  ist, wenn man es nicht war ("Passwort vergessen" + Support). Keine Tokens, kein Link außer `{FRONTEND_URL}/forgot-password`;
  Name per Twig escaped.
- Versand über `DeferredMailer` nach der Antwort; Transportfehler werden geloggt, der Ablauf und die Antwort bleiben
  gleich (kein Orakel). Keine Mail bei Fehlschlägen/Validierungsfehlern, bei `forgot-password` (Spam-Vektor) und an
  vergebene neue Adressen (Spam-Vektor, siehe "Konten").

### Paket 4: Terminserien (2026-10-13)

Migration `Version20261014120000`: Tabelle `event_series` (`id` UUID, `calendar_id` FK `ON DELETE CASCADE`,
`template_id` FK `ON DELETE SET NULL`, `frequency`, `weekday`, `nth`, `start_date`, `until_date` ODER `occurrences`,
`skip_holidays`, `duration_days`, `created_at` UTC) und `event.series_id` (FK `ON DELETE SET NULL`, Index
`idx_event_series`). Entity `App\Entity\EventSeries`, Regel und Terminberechnung `App\Service\SeriesRule` (die EINZIGE
Stelle, die Daten einer Regel berechnet; das Frontend zeigt die Vorschau des Servers), Anlegen/Vorschau
`App\Service\EventSeriesService`, Bearbeiten/Löschen mit Geltungsbereich `EventService`. Tests
`EventSeriesTest` (31 Fälle, alle ohne Umsetzung rot).

- **Regel** `rule: {frequency: "weekly" | "biweekly" | "monthly", weekday: 0–6 (0 = Sonntag), nth?: 1–4 | 5 (= letzter;
  nur und Pflicht bei monthly), startDate, until? | count? (genau eines), skipHolidays?: false}`. Wöchentlich: jeder
  `weekday` ab `startDate` (der Starttag zählt, wenn er passt); zweiwöchentlich: jeder zweite ab dem ersten Treffer;
  monatlich: der n-te (bzw. letzte) Wochentag jedes Monats ab `startDate`. `until` inklusiv; `count` = Anzahl der
  ANGELEGTEN Termine (ausgelassene Feiertage zählen nicht). Datumsarithmetik in ganzen Kalendertagen (UTC): Sommer-/
  Winterzeit verschiebt keinen Tag, Uhrzeiten bleiben Wanduhrzeit in der Zone des Termins; Schaltjahre (29.02.)
  korrekt. Fehler 400 `validation_failed` mit `field` `rule.frequency|weekday|nth|startDate|until|count|skipHolidays`
  bzw. `rule` (beide oder keines von `until`/`count`, kein Objekt).
- **Obergrenze 366 Termine je Serie** (`SeriesRule::MAX_EVENTS`, ein Jahr täglich): darüber 422 `too_many_events`
  (auch `count` > 366, field `rule.count`); Vorschau und Anlegen gleich. Ebenso mehr als 366 ausgelassene Feiertage
  (Feiertage, die fast jeden Tag abdecken, halten die Suche nicht am Laufen). Kein Termin beginnt oder endet nach
  9999-12-31 (letzter Tag der Datenbank; eine `count`-Regel liefert dann weniger Termine).
- **Feiertage:** aus den Feiertagskalendern des Kalenders (`HolidayEventRepository::findByCalendar`, nie aus anderen
  Kalendern), Überlappung wie `…/holiday-events` (`date ≤ Tag ≤ COALESCE(dateEnd, date)`). Ein Termin liegt auf einem
  Feiertag, wenn irgendein Tag des Termins (mehrtägig: `date … date + durationDays`) einen überlappt.
- `POST /api/calendars/{id}/events/series/preview {rule, event?: {durationDays}}` → `{dates, count, skippedHolidays:
  [{date, name}], holidays: [{date, name}]}` (`holidays` = alle Daten der Regel auf einem Feiertag, ausgelassen oder
  nicht). Schreibt nichts; keine Treffer = `count: 0` (kein Fehler). Mitglied, nicht archiviert.
- `POST /api/calendars/{id}/events/series {rule, templateId?, event?: {name, timeBegin, timeEnd, isAllDay, timezone,
  locationId, propertyIds, featureIds, targetGroupIds, isDraft, durationDays}, isDraft?}` → 201 `{series, events}`.
  Vorlagenwerte wie `from-template` (`EventService::templateInput`, Vorlage ohne Zeiten → ganztägig 00:00–23:59),
  `event`-Felder überschreiben sie; ohne Vorlage sind `event.name` und Zeiten (oder `isAllDay: true`) Pflicht.
  Standard Entwurf. Mehrtägig: `event.durationDays` (0–31) setzt `dateEnd = date + Dauer`; `event.date`/`dateEnd`
  → 400. Zeitzone je Termin wie bisher (Vorlage/Anfrage, sonst `null` = Kalenderzone). Referenzen nur aus dem eigenen
  Kalender (`templateId` und Zuordnungen fremd/unbekannt → 422 `unknown_reference`), doppelte IDs einmal. Ein Flush:
  ein Fehler speichert nichts (weder Serie noch Termine). Keine Termine → 422 `validation_failed` field `rule`.
  Fehler in Terminfeldern tragen `event.<feld>`.
- `GET /api/calendars/{id}/event-series/{seriesId}` → `{id, calendarId, templateId, rule: {…, durationDays},
  eventCount, createdAt}` (Mitglied, auch im Archiv; Serie eines anderen Kalenders 404).
- **Terminlisten und Einzel-GET** liefern `seriesId` (ohne Zusatzabfrage); nur der Einzel-GET zusätzlich `series:
  {id, calendarId, templateId, rule, eventCount, createdAt}` bzw. `null`.
- **Bearbeiten** `PATCH …/events/{id}` mit `scope: "this" | "all"` (Standard `this`, rückwärtskompatibel; sonst 400
  field `scope`). `this`: nur dieser Termin, **er bleibt in der Serie** (`seriesId` bleibt; Entscheidung: das Design
  kennt kein "aus der Serie lösen", und "Alle Termine der Reihe" soll ihn später weiter erreichen). `all`: die
  GESENDETEN Felder (Name, Zeiten, Ganztägig, Zeitzone, Status, Ort, Eigenschaften, Features, Zielgruppen) gelten für
  alle Termine der Serie; **Datum/Enddatum (und Vorlage) nur für diesen Termin** (das Design nennt keine Regel; jeder
  Termin behält seinen Tag). Nicht gesendete Felder bleiben bei jedem Termin wie sie sind, auch einzeln abweichend
  bearbeitete (das Frontend sendet bei "alle" nur die geänderten Felder). Ohne Serie wirkt `all` wie `this`. Atomar
  (ein Flush; ungültige Werte oder fremde Referenzen → nichts geändert), Archiv 403, Zuordnungen per Differenz
  (`LinkCollectionSync`), Lesezugriffe konstant (Zuordnungen der Serientermine je Typ mit einer Abfrage geladen;
  Nachweis `EventSeriesTest::testEditingAllRunsTheSameNumberOfQueriesForLongerSeries`: 4 vs. 13 Termine unterscheiden
  sich nur um die Schreibzeilen).
- **Löschen** `DELETE …/events/{id}?scope=this|all` (Standard `this`; sonst 400). `all` löscht alle Termine der Serie
  und die Serie (eine Transaktion); `this` nur den Termin. **Eine Serie ohne Termine wird entfernt** (nach Einzel-,
  Serien- und Sammellöschung `POST …/events/bulk` `delete`, in derselben Transaktion). Sammelaktionen behandeln
  Serientermine wie andere (einzeln).
- **Sonstiges:** Zähler (`eventCount` von Kalender/Verein/Vorlage) zählen Serientermine normal. **Kalender
  duplizieren** kopiert weiterhin keine Termine und damit keine Serien (Test). Kalender/Verein löschen entfernt die
  Serien (FK-Kaskade), Vorlage löschen setzt `event_series.template_id` und `event.event_template_id` auf `NULL`
  (Termine und Serie bleiben). ICS/Export: Serientermine bleiben einzelne VEVENTs (keine Serienkennung).
- **Frontend:** "Termin aus Vorlage" (`EventFromTemplateModal`) legt Serien an (`POST …/events/series`); die Vorschau
  kommt entprellt (300 ms) vom Server (`components/events/useSeriesPreview.ts`; Lade-, Fehler- mit "Erneut
  versuchen", Obergrenzen- und Leerzustand, "Keine Termine zum Anlegen"); der Regelrechner im Browser ist entfallen
  (`lib/events/series.ts` enthält nur noch Typen, Vorschauzeilen, Regeltext und den Änderungs-Diff). Erfolg: Toast "n
  Termine angelegt.", zurück; Fokus auf den ersten Termin, wenn er im sichtbaren Zeitraum liegt, sonst zum Auslöser, bei einem Deep-Link zur Seitenüberschrift (Monatstitel). Tag "Wiederkehrend" (`Tag tone="brand"`, Design Library)
  in der Terminliste, an `EventItem` (Tagespanel, mobile Tagesliste) und im Kopf des Bearbeiten-Dialogs; nicht an
  den Chips im Monatsraster (Design MonthView zeigt dort keinen). Bearbeiten-Dialog: Hinweis "Teil einer Terminreihe
  (n Termine)" mit Regeltext; Speichern (mit Änderungen) und Löschen eines Serientermins fragen per `ConfirmDialog`
  (neu: `alternative`-Aktion) "Nur diesen Termin" / "Alle Termine der Reihe" / "Abbrechen" (Fokus auf Abbrechen,
  Escape bricht ab); bei Datumsänderung erklärt der Dialog, dass das Datum nur für diesen Termin gilt. Wortlaut eigen
  (Dialogs.dc.html enthält keine Serien-Dialoge).

### Paket 3: Auth und Konten (2026-10-13)

Migration `Version20261013120000` (`password_reset`, `email_change`, `passkey.last_used_at`,
`club_user.last_calendar_id`). Tests `PasswordResetTest`, `AccountTest`, `OAuthLinkTest`, `WebAuthnTest`.

- **Passwort vergessen** `POST /api/auth/forgot-password {email}` → immer 204 (kein Orakel, auch über dem Limit);
  Token 32 Byte, nur als SHA-256 gespeichert, 60 Minuten, Mail und Datenbankarbeit nach der Antwort
  (`DeferredMailer::defer()`); Limiter `password_reset_email` (3/h je Adresse) und `password_reset_ip` (20/h je IP).
  `POST /api/auth/reset-password {token, password}` → 204 oder 400 `invalid_reset_token`; Einmalnutzung per bedingtem
  UPDATE; setzt das Passwort, bestätigt die Adresse, beendet alle Sitzungen (`token_version`), verwirft offene Links
  und einen wartenden E-Mail-Wechsel. SSO-only-Konten bekommen so ein Passwort.
- **Passwort-Policy** 8–128 Zeichen überall (`App\Validator\PasswordPolicy`, Frontend `lib/password.ts`).
- **Profil:** `PATCH /api/auth/me {name}`; `POST /api/auth/change-password` → neue Tokens, andere Sitzungen enden (400
  `invalid_credentials` field `currentPassword`, 409 `no_password`); `POST /api/auth/change-email {email, password}`
  → 204, Link an die neue Adresse (24 h) nur wenn frei, sonst gleich aussehend ohne Link (kein Orakel); `DELETE
  …/change-email`; `GET /api/auth/verify-new-email?token=` leitet auf `/auth/verify-email?status=email_changed` bzw.
  `status=error&reason=…&flow=email_change`; Erfolg beendet alle Sitzungen.
- **SSO verknüpfen/trennen:** `POST …/oauth/{provider}/link-start` → Einmal-Ticket → Anbieter → Callback leitet mit
  `link_proof` auf `/profile` → `POST …/oauth/{provider}/link-complete {proof}` mit dem JWT desselben Nutzers (Schutz
  gegen Link-CSRF); `DELETE /api/auth/oauth/{provider}` (409 `last_login_method`, Zeilensperre). `GET /api/auth/me`
  liefert `hasPassword`, `pendingEmail`, `oauthAccounts[].provider`.
- **Passkeys** `lastUsedAt`; **letzter Kalender je Mitgliedschaft** (`lastCalendarId` in `GET /api/clubs`).
- **Console:** `app:user:verify <email>`, `app:user:reset-link <email>`, `app:prune-password-resets`.
- **Mails** `reset_password.mjml`, `confirm_new_email.mjml` (de/en, Link zusätzlich als Text); **Logs:**
  `RedactTokensProcessor` entfernt `token`/`ticket`/`secret`/… aus Query-Strings (Grenzen: Exception-Texte,
  Webserver-Logs, Referer der ersten Seitenanfrage).

### Paket 2: Import, Export, Sammelaktionen, Fehlercodes

Migration `Version20261010120000` (`event.external_uid`, Index `(calendar_id, external_uid)`). Tests `ImportTest`,
`ExportBulkTest`, `ErrorCodesTest`.

- `POST …/events/import/preview` (schreibt nichts): Status je Eintrag `new | duplicate | invalid` (Duplikat = gleiche
  `externalUid` oder gleicher Name am gleichen Startdatum), Fehler mit `events[n].feld`, `warnings`.
- `POST …/events/import {events, locations?: [{tempId, …}], skipDuplicates?}` → atomar (ein Flush, neue Orte nur wenn
  genutzt), `{imported, skipped, createdLocations, ids, warnings}`; höchstens 5000 Termine/Orte je Request (413
  `too_many_events`); unbekannte Zeitzonen → Kalenderzone + Warnung `timezone_replaced`.
- `GET …/events.ics?from&to&includeDrafts&targetGroupIds[]` (Mitglied, auch im Archiv): Entwürfe als `TENTATIVE`,
  sicherer `Content-Disposition`, `no-store`.
- `POST …/events/bulk {ids, action: publish | draft | delete}` → `{affected}`, atomar, höchstens 5000 IDs (413).

### Paket 1: Zähler, Einzel-Endpoints, öffentlicher Kopf (2026-10-09)

Migration `Version20261009120000` (Vorlagen-Zeiten nullable). Tests `CountersTest`, `PublicFeedDetailsTest`,
`TemplateTimesTest`.

- **Zähler** je Liste mit einer gruppierten Abfrage (`App\Service\UsageCounts`, Nachweis ohne N+1 mit
  `tests/Helper/QueryCounter`): Vereine `calendarCount`/`archivedCalendarCount`/`memberCount` (Einzel-GET zusätzlich
  `eventCount`/`feedCount`), Kalender `eventCount`/`templateCount`/`feedCount`, `usage` von Eigenschaften/Features/
  Zielgruppen/Orten (Namen nur bis 3 Treffer), `eventCount` von Vorlagen.
- `GET …/feeds/{feedId}`; öffentlicher Feed mit Kopf (`clubName`, `calendarName`, wirksame `timezone`, `visibility`,
  `eventCount`, `audiences`), `from`/`to`, Feiertagen und Einzeltermin `GET /api/feed/{id}/events/{eventId}`
  (Geheimnis zuerst, kein Orakel).
- Doppelte Namen von Eigenschaften/Features/Zielgruppen → 422 `duplicate_name` (Vergleich in PHP, Unicode-trim,
  Groß/Klein egal); Kalender duplizieren mit optionalem `{name}`.
- **Vorlagen-Zeiten optional** (nur paarweise): Vorlage ohne Zeiten und Anfrage ohne Zeiten → ganztägiger Termin
  (00:00–23:59); `overrides.isAllDay: false` ohne Zeiten → 400.

### Fehlercodes

RFC-7807-Body `{type, title, status, detail, code, field?}` über `App\Exception\ApiProblemException`
(`ExceptionListener`); `detail` bleibt menschenlesbar und ist kein Vertrag.

| Code | Status | Wo |
| --- | --- | --- |
| `validation_failed` | 400/422 | Eingabefehler mit `field` (`Input`, DTO-Validierung 422, Import `events[n].feld`, Export-Parameter, Bulk, Serienregel `rule.*` 400, Serie ohne Termine 422 field `rule` (auch nach einer Regeländerung), `scope`, Feeds: `visibility` 400, `searchable` 400 / 422 bei nicht-öffentlichem Feed) |
| `invalid_request` | 400 | Body ist kein JSON-Objekt, Passkey-Body unvollständig |
| `unknown_reference` | 422 | ID nicht im Kalender (`CalendarReferences`, Bulk-`ids`, Export-`targetGroupIds`, Import-`locationTempId`, Serien-`templateId`) |
| `duplicate_name` | 422 | Name im Kalender schon vergeben |
| `too_many_events` | 413 / 422 | 413: Import > 5000 Termine/Orte, Bulk > 5000 IDs; 422: Serie > 366 Termine (Vorschau, Anlegen, Regel ändern) |
| `series_empty` | 409 | `…/event-series/{id}` `preview-update` / `PATCH`: die Serie hat keine Termine (kein Prototyp) |
| `series_changed` | 409 | `PATCH …/event-series/{id}`: Prototyp/Referenz gleichzeitig gelöscht oder Deadlock; nichts geändert, erneut versuchen |
| `email_taken` | 400 | Registrierung, field `email` |
| `invalid_credentials` | 401 / 400 | Login 401 (kein Orakel); 400 bei `change-password` (field `currentPassword`) und `change-email` (field `password`) |
| `invalid_reset_token` | 400 | `reset-password`: unbekannt, benutzt oder abgelaufen (gleiche Antwort), field `token` |
| `no_password` | 409 | `change-password` / `change-email` für SSO-only-Konten |
| `last_login_method` | 409 | `DELETE /api/auth/oauth/{provider}`: es bliebe keine Anmeldemethode |
| `oauth_account_not_found` | 404 | `DELETE /api/auth/oauth/{provider}`: Anbieter nicht verknüpft |
| `unknown_provider` | 404 | `POST /api/auth/oauth/{provider}/link-start` |
| `invalid_state` / `account_in_use` / `already_linked` | 400 / 409 / 409 | `POST …/oauth/{provider}/link-complete` |
| `email_not_verified` | 403 | Login mit unbestätigter Adresse; Body bleibt `{error: "email_not_verified", code: "email_not_verified"}` |
| `invalid_grant` | 400 | `POST /api/auth/token` ohne `grant_type=refresh_token` / Token |
| `invalid_refresh_token` | 401 | Refresh-Token ungültig, abgelaufen, Nutzer weg oder Sitzungen beendet |
| `invalid_passkey` | 401 | Passkey-Anmeldung gescheitert |
| `invalid_passkey_registration` / `passkey_already_registered` | 400 | Passkey-Registrierung |
| `passkey_not_found` | 404 | Passkey löschen (fremd oder unbekannt) |

Andere 4xx (403/404 der Voter, Datumsparameter der Terminliste, Feeds, Feiertage) haben keinen Code. E-Mail-Bestätigung
und Adresswechsel leiten mit `?status=error&reason=invalid | expired | already_used | email_taken` weiter;
`resend-verification` antwortet immer 204. **OAuth** (`?error=` an `{FRONTEND_URL}/auth/callback`): `invalid_state`,
`provider_denied`, `provider_error`, `oauth_failed`, `email_missing`, `account_exists`, `email_unverified_at_provider`;
**SSO verknüpfen** (`?link_error=` an `/profile`): `invalid_state`, `provider_denied`, `provider_error`, `oauth_failed`.

## Behobene Bugs (Backend)

Alle mit Tests; Details in den Commits.

- **`b6537e7`** – Termin/Vorlage mit unveränderten Zuordnungen ändern lief in `EntityIdentityCollisionException`
  (500); jetzt Differenz (`App\Service\LinkCollectionSync`), PATCH-Antworten liefern Listen.
- **Phase 7** – `GET /api/auth/me` nach Passkey-Registrierung 500 (Blob als Stream hydriert).
- **`eaa9831`** – ICS: `DTEND` mehrtägiger Ganztagstermine einen Tag zu spät; `?targetGroupIds=` am öffentlichen Feed
  konnte die Zielgruppen des Feeds erweitern (jetzt Schnittmenge).
- **`7b218c2`** – Doppelte IDs in Zuordnungen → 500 (dedupliziert); Mandantentrennung über
  `App\Service\CalendarReferences` (unbekannte und fremde IDs → 422; Frontend lädt veraltete Formulare neu,
  `src/lib/staleReferences.ts`); Eingabeprüfung 400 statt 500; nur gültige IANA-Zonen; `VTIMEZONE` je TZID;
  Überlappungsfilter der Terminliste; privater Feed eines archivierten Kalenders verriet den Archivstatus; CORS bei 404
  aus `#[MapEntity]` (`symfony/http-kernel` 8.1.1); `PATCH …/feeds/{id}` lieferte `targetGroups` als Objekt;
  Kartenbild von Entwürfen; Mapbox-Proxy mit Punkt-Segmenten; SSRF der Feiertagskalender
  (`NoPrivateNetworkHttpClient`); `guzzlehttp/guzzle` aktualisiert.
- **`fe1dc8c`** – Passkeys prüften weder Signatur noch authenticatorData (kritisch; jetzt vollständig mit
  `web-auth/webauthn-lib`, einmalige Challenges über `auth_nonce`); OAuth-State signiert, einmalig, an ein
  HttpOnly-Cookie gebunden; Konto-Verknüpfung per E-Mail nur mit vertrauenswürdigem `email_verified` (nie Microsoft).
- **`9cc6f10`** – Sitzungen überlebten den Entzug von Zugangsdaten (hoch): `user.token_version` (Migration
  `Version20261004130000`) in Access- und Refresh-Token, geprüft bei Refresh und jeder Anfrage
  (`SessionVersionListener`).
- **(Frontend)** Der Feed-Typ hieß `targetGroupid` (API: `targetGroupId`), die alte Feedliste zeigte keine Zielgruppen.

## Betrieb

- **Migrationen** auf Dev und Prod ausführen (`npm run migrate`; Deploy und Container-Entrypoint machen es
  automatisch): `Version20261004120000` (`auth_nonce`), `Version20261004130000` (`user.token_version`),
  `Version20261009120000` (Vorlagen-Zeiten nullable), `Version20261010120000` (`event.external_uid`),
  `Version20261013120000` (`password_reset`, `email_change`, `passkey.last_used_at`, `club_user.last_calendar_id`),
  `Version20261014120000` (`event_series`, `event.series_id`), `Version20261015120000` (Feed-Status: `PUBLIC` →
  `CLUB`, `PRIVATE` bleibt, `calendar_feed.searchable`). Nach dieser Migration sind bisher öffentliche Feeds
  vereinsintern (nicht indexiert); wer einen Feed in Suchmaschinen haben will, stellt ihn auf "Öffentlich" und
  schaltet "Für Suchmaschinen auffindbar" ein.
- **Umgebungsvariablen (Produktion):** `APP_SECRET` (signiert Passkey-Challenges, OAuth-State und SSO-Tickets; ein
  Wechsel macht laufende Anmeldevorgänge ungültig) und `JWT_REFRESH_SECRET` müssen gesetzt sein (Platzhalter in
  `.env`). `APP_URL` = öffentliche Adresse; `FRONTEND_URL`, `BACKEND_URL` und `WEBAUTHN_RP_ID` leiten sich daraus ab
  (`config/services.yaml`) und werden nur bei getrennten Hosts gesetzt (für Tests setzt sie `phpunit.dist.xml`).
  `BACKEND_URL` muss die öffentliche API-Adresse sein (Link der neuen E-Mail-Adresse, SSO-Link-Start).
  `WEBAUTHN_RP_NAME`, optional `WEBAUTHN_USER_VERIFICATION` (`preferred`/`required`); erlaubte Passkey-Origin ist
  `FRONTEND_URL` (exakt).
- **Cron:** `php bin/console app:prune-unverified-users` und `php bin/console app:prune-password-resets` (z. B.
  täglich; abgelaufene Reset-Links und E-Mail-Wechsel).
- **Mail-Templates:** nach Änderungen an `templates/email/*.mjml` `npm run build:mail -w backend` (die kompilierten
  `*.html.twig` sind eingecheckt; `npm run build` baut sie ebenfalls). Seit Paket 5 auch `password_changed`,
  `email_change_requested`, `email_changed` (Hinweis-Mails ohne Links außer `/forgot-password`).
- **Reverse Proxy:** der IP-Limiter von "Passwort vergessen" nutzt `Request::getClientIp()`; hinter einem Proxy, der
  die Client-Adresse nicht als `REMOTE_ADDR` weitergibt, `framework.trusted_proxies` setzen (sonst teilen sich alle
  Nutzer einen Zähler).
- **Support:** `app:user:verify <email>` bestätigt eine Adresse, `app:user:reset-link <email>` gibt einen Reset-Link
  aus (60 Minuten gültig, gewährt Zugang zum Konto: nur an den Eigentümer).
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
- **Nach einem Deploy** fehlen die Chunks des vorigen Releases; das Frontend lädt bei einem fehlgeschlagenen
  Chunk-Import einmal neu (`vite:preloadError` in `frontend/src/main.tsx`).
