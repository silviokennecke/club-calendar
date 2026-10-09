# Backend-Lücken und offene Risiken (Endstand Redesign)

Stand: 2026-10-09, nach Paket 1 des Umsetzungsplans (`BACKEND-PLAN.md`; vorher: 2026-10-06, nach Phase 9). Hier steht, was das Design braucht und das Backend (noch) nicht bietet, welche
Sicherheitsrisiken offen sind, welche Backend-Fehler während des Redesigns behoben wurden und was im Betrieb zu tun
ist. Zuordnung zu den Artboards: `COVERAGE.md`; Umsetzungsplan: `PLAN.md`; E2E-Umgebung: `E2E.md`.

## Kurzfassung und Prioritäten

1. **Vor produktiver Nutzung (Betrieb):** Migrationen `Version20261004120000` (Tabelle `auth_nonce`),
   `Version20261004130000` (`user.token_version`) und `Version20261009120000` (Vorlagen-Zeiten) auf Dev und Prod ausführen; `APP_SECRET`, `JWT_REFRESH_SECRET` und
   `WEBAUTHN_*` in Produktion setzen; SSO nur über HTTPS (State-Cookie). Siehe "Betrieb".
2. **Sicherheit, mittel:** Vorab-Registrierung mit fremder Adresse (Passwort des Registrierenden gilt nach dem Klick
   des Eigentümers), fehlendes Rate-Limiting, nicht rotierende/widerrufbare Refresh-Tokens. Siehe "Offene
   Sicherheitsrisiken".
3. **Features mit sichtbarer UI-Lücke ("Bald verfügbar"):** Passwort vergessen/zurücksetzen, Terminserien,
   SSO verknüpfen/trennen, Profil (Name/E-Mail/Passwort) ändern.
4. **Zähler und Einzel-Endpoints:** umgesetzt (Paket 1, siehe "Umgesetzt (Paket 1)"). Offen bleiben kurze
   Feed-Adressen (Slugs) und ein Zustand "Kalender archiviert" im öffentlichen Feed.
5. **Robustheit:** serverseitiger Import mit Dry-Run und Transaktion, Export-Endpoint, Bulk-Endpoints, stabile
   Fehlercodes.

## Offene Backend-Features

### Auth und Konten

- **Passwort vergessen / zurücksetzen:** kein Endpoint (Design: ForgotPassword). Die Seite `/forgot-password` ist
  gebaut, Absenden deaktiviert ("Bald verfügbar"); der Zustand "Prüfe dein Postfach" fehlt (COVERAGE L2). Ein
  Reset wäre auch die Behebung des Vorab-Registrierungs-Risikos (siehe unten).
- **Profil:** Name, E-Mail und Passwort lassen sich nicht ändern (`PATCH /api/auth/me` kennt nur Datumsformat,
  Wochentag, Sprache, zuletzt genutzter Verein/Kalender). Die UI zeigt den Design-Hinweis "Name und E-Mail können
  hier noch nicht geändert werden."; "Passwort ändern" ist im Design nicht vorgesehen und fehlt daher auch in der UI.
- **Verknüpfte Anmeldungen:** `GET /api/auth/me` liefert nur `oauthAccounts[].provider`, `GET /api/auth/providers`
  die konfigurierten Anbieter. Es gibt keinen Endpoint zum Verknüpfen mit dem angemeldeten Konto (der OAuth-Start
  legt ein Konto an oder meldet an) und keinen zum Trennen; die Profilseite zeigt den Status, die Aktionen sind
  deaktiviert (COVERAGE L4). Der Schutz "mindestens eine Anmeldemethode muss bleiben" fehlt im Backend. Folge der
  SSO-Policy: Microsoft-Nutzer mit bestehendem Passwort-/Google-Konto können Microsoft nicht hinzufügen.
- **Passkeys:** Die Liste kennt nur Gerätename und `createdAt`, kein "zuletzt benutzt". Der Name ist optional;
  ohne Angabe sendet das Frontend "Dieses Gerät" / "This device" (Backend-Default wäre `null`).
- **Fehlercodes Registrierung/Login:** Fehler kommen als RFC-7807-JSON (`detail`), nur Login-403 als
  `{error: "email_not_verified"}`. Das Frontend erkennt "E-Mail bereits vergeben" am Text `Email already in use`
  (`apiPost` liest `error ?? detail`). Ein stabiler Code (z. B. `code: "email_taken"`) wäre robuster.
- **OAuth-Fehler:** Seit dem Sicherheits-Fix kommen Codes (`invalid_state`, `oauth_failed`, `email_missing`,
  `account_exists`) in `?error=`; das Frontend zeigt dafür noch eine generische SSO-Meldung. Feinere Codes (vom
  Anbieter abgelehnt, E-Mail beim Anbieter unbestätigt, ...) und eigene Texte wären möglich.
- **Theme** wird nur im Browser (localStorage) gespeichert, nicht am Benutzer (bewusst laut Plan; nur relevant,
  falls geräteübergreifend gewünscht).
- **E2E-Bestätigung:** Kein verifizierter Weg, in E2E-Tests einen Nutzer ohne Mailversand zu bestätigen
  (`MAILER_DSN=null`); `e2e/onboarding.spec.ts` setzt `is_email_verified` per PHP-PDO direkt in der E2E-Datenbank.
  Sauberer wäre eine Console-Command (`app:user:verify <email>`) oder ein Test-Endpoint.
- **Zuletzt genutzter Kalender:** Am Benutzer stehen nur `lastClubId`/`lastCalendarId` (ein Paar). Den letzten
  Kalender je Verein merkt sich das Frontend im Browser (`lastCalendar:<clubId>`); geräteübergreifend bräuchte es
  ein Feld je Mitgliedschaft.

### Termine und Serien

- **Terminserien:** Event hat keine Wiederholungsregel (Design: EventSeries). Die Seite "Termin aus Vorlage" ist
  gebaut; Regel (wöchentlich, zweiwöchentlich, n-ter Wochentag), Feiertage auslassen und Vorschau laufen
  clientseitig (`src/lib/events/series.ts`), "Serie anlegen" ist deaktiviert (COVERAGE L3). Einzeltermine nutzen
  `POST …/events/from-template` mit einem Datum; der Endpoint nimmt schon mehrere Daten an und legt unverbundene
  Einzeltermine an. Für echte Serien fehlen Serien-ID/Regel am Event und Endpoints für "nur dieser Termin / alle
  Termine der Serie" (Design: Serien-Dialoge).
- **Sammelaktionen** der Terminliste (veröffentlichen, Entwurf, löschen) laufen als Einzel-Requests
  (`Promise.allSettled`). Ein Bulk-Endpoint (`PATCH/DELETE …/events` mit `ids`) wäre atomar und schneller.
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

- **Import ohne Vorab-Prüfung:** `POST …/events/import` legt direkt an (kein Dry-Run, nur `{imported}`, max. 500
  pro Request). Die Prüfansicht parst die ICS-Datei im Browser (`src/lib/import/ics.ts`: UTC in Kalenderzone,
  RRULE wird nicht ausgeschrieben, Windows-Zeitzonennamen auf IANA, windows-1252 wird im Browser gelesen, das
  Backend bekommt immer UTF-8-JSON). Nötig: `POST …/events/import/preview` mit Duplikat-Erkennung (UID, Name +
  Datum), Serienauflösung und Fehlern je Termin, dazu ein stabiler Import-Bezug (`externalUid`). Das Duplikat-Banner
  vergleicht heute clientseitig Name + Datum.
- **Import nicht atomar:** Neue Orte werden vorab einzeln per `POST …/locations` angelegt, Termine in Blöcken zu 500;
  scheitert ein späterer Block, bleiben Orte und frühere Blöcke (UI: "nur teilweise gelungen"). Ein Endpoint für
  Orte + Termine in einer Transaktion mit Zählern (neue Orte, übersprungene Termine) wäre robuster. Restfall: Wurden
  Zuordnungen während der Prüfansicht gelöscht, bricht der Import mit Fehlermeldung ab.
- **Veraltete TZIDs** wie `US/Pacific-New` (Browser kennt sie, PHP nicht) lassen einen Import insgesamt mit 422
  scheitern.
- **Export:** kein Endpoint. Die Export-Seite baut die ICS-Datei im Browser aus `GET …/events`
  (`src/lib/events/ics.ts`, gleiche UID/Summary/Description wie `IcsService`, Zeiten in UTC, kein VTIMEZONE, kein
  `X-APPLE-STRUCTURED-LOCATION`). Besser: `GET /api/calendars/{id}/events.ics?from&to&includeDrafts&targetGroupIds`
  auf Basis von `IcsService`. CSV-Export ist weder im Design noch gebaut.

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
- Kein Test-/Dev-Weg zur Nutzerbestätigung (siehe Auth), kein eigener E2E-Seed außer den Fixtures.

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

## Offene Sicherheitsrisiken

| Schweregrad | Risiko | Details / mögliche Behebung |
| --- | --- | --- |
| mittel | **Pre-Hijacking bei lokaler Vorab-Registrierung** | Registriert jemand mit fremder Adresse und eigenem Passwort und klickt der echte Eigentümer den (unaufgefordert erhaltenen) Bestätigungslink, gilt das Passwort des Registrierenden: Er meldet sich danach an, auch neben einem späteren Google-Login des Eigentümers (Adresse ist dann bestätigt, keine Bereinigung). Die Sitzungs-Invalidierung hilft nicht (vor der Bestätigung gibt es keine Sitzung). Nachgestellt in `SessionInvalidationTest::testPreRegisteredPasswordStillWorksAfterTheOwnerConfirms`. Voraussetzung: Das Opfer klickt einen Link zu einer Registrierung, die es nicht angelegt hat. Behebung braucht ein Feature (Passwort bei der Bestätigung neu setzen bzw. Passwort-Reset); das Passwort beim Bestätigen zu löschen sperrte ohne Reset den Eigentümer aus. |
| mittel | **Kein Rate-Limiting** | `/api/auth/login`, `/api/auth/token`, Passkey-Verify und OAuth-Callback sind unbegrenzt (Brute Force, Credential Stuffing). Symfony RateLimiter je IP + Konto. |
| mittel | **Refresh-Tokens ohne Rotation/Widerruf** | Zustandslos, 7 Tage: Wiederverwendung bleibt unbemerkt, Abmelden und Passkey-Entfernen beenden bestehende Sitzungen nicht. Nur `user.token_version` beendet alle Sitzungen eines Nutzers; "überall abmelden" gibt es nicht. Bräuchte eine Token-Tabelle. |
| niedrig–mittel | **Tokens im Query** | SSO leitet auf `/auth/callback?token=…&refresh_token=…`: Tokens landen in Browser-Verlauf und ggf. Server-Logs des Frontend-Hosts (Referrer nur, falls die Callback-Seite externe Ressourcen lädt). Fragment (`#token=…`) wäre besser (Frontend + Backend). |
| niedrig–mittel | **Karten-Bilder privater Termine/Orte** | `GET /api/map/image/event/{id}` liefert das Kartenbild auch für veröffentlichte Termine, die nur in privaten Feeds stehen, `GET /api/map/image/location/{id}` für jeden Ort (jeweils nur mit bekannter UUID; Entwürfe antworten 404). Eine Prüfung bräuchte einen Feed-/Geheimnis-Bezug. Der Event-Endpoint wird von Frontend und Mails derzeit nicht genutzt. |
| niedrig | **ID-Token-Claims ungeprüft** | `OidcProvider` prüft beim ID-Token weder Signatur noch `aud`/`iss`/`exp`. Das Token kommt direkt vom Token-Endpoint über TLS (nach OIDC zulässig), im Code-Flow mit Client-Secret nicht ausnutzbar; `iss` ist bei Microsoft `common` mandantenabhängig, daher kein trivialer Fix. |
| niedrig | **Microsoft-Konto blockiert Registrierung** | Ein per Microsoft angelegtes unbestätigtes Konto mit fremder Adresse blockiert dauerhaft die lokale Registrierung des Eigentümers (`Email already in use`; `app:prune-unverified-users` löscht SSO-Konten nicht). Erst ein Google-/Apple-Login mit bestätigter Adresse löst das. |
| niedrig | **Passwort-Hashing** | `App\Entity\User` nutzt explizit `bcrypt` (Kosten 13) statt `auto`; bcrypt kürzt nach 72 Bytes, `RegisterDto` hat keine Maximallänge. Umstellung auf `auto` (argon2id) mit Rehash bei Anmeldung möglich. |
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
  `Version20261004130000` (`user.token_version`, Standard 0) und `Version20261009120000` (Vorlagen-Zeiten nullable).
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
