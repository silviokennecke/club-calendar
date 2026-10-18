# Design-Abdeckung (Phase 9a)

Stand: 2026-10-13 (Paket 4 des Backend-Plans: Terminserien; vorher am selben Tag Paket 3, 2026-10-09 Paket 1, 2026-10-06). Quelle: Design-Artifact (lokal `…/artifact-files/469a6604-…/project/`, 72 Artboards laut
`canvas.json`, Stand inkl. Korrektur "Termine = Modals" vom 2026-10-04). Pfade unten relativ zu `frontend/src/`,
Routen relativ zu `/clubs/:clubId/calendars/:calendarId` (= `…`).

Vorgehen: Jedes Artboard (HTML + `data-dc-script` mit Zuständen/Props) gelesen und der Umsetzung zugeordnet.
Alle deutschen Texte der Artboards wurden maschinell gegen `locales/de.json` abgeglichen (Skript im Scratchpad,
`cov/texts.py`); übrig blieben Beispieldaten (Vereins-, Termin-, Ortsnamen), Canvas-Überschriften ("Zustand: …",
"a) Kalender lädt") und die unten aufgeführten Abweichungen. Zustände, Interaktionen und Mobil-Verhalten wurden
gegen Komponenten und Tests geprüft.

Status: **vollständig** = Inhalte, Zustände, Texte, Interaktionen und Mobil-Verhalten umgesetzt;
**abweichend** = bewusst anders (Begründung, ggf. `BACKEND-GAPS.md`); **Lücke** = fehlt.

## Ergebnis

- 72 Artboards: alle **vollständig** bis auf **3 abweichende** (bewusst, begründet: CalendarArchived, Feeds,
  Profile), **0 offene Lücken in der Zuordnung** (Paket 4: EventSeries jetzt vollständig, kein "Bald verfügbar" mehr
  in der App; Paket 3: ForgotPassword; Profile bleibt "abweichend", weil es über das Design hinausgeht).
  Offene Teil-Lücken innerhalb abweichender Artboards: siehe "Offene Lücken".
- In dieser Prüfung behoben: 9 Design-Punkte (siehe "Behobene Lücken"), davon 5 aus dem abgebrochenen Vorlauf übernommen, plus ein Nebenbefund (Sitzung beim Seitenwechsel).

## Zugang

| Artboard | Umsetzung (Datei / Route) | Status |
| --- | --- | --- |
| Main.dc.html (Anmeldung) | `pages/LoginPage.tsx`, `/login`; `components/auth/AuthLayout.tsx` (Logo, LangSwitch, Skip-Link) | vollständig (E-Mail/Passwort, Passkey, SSO-Buttons je konfiguriertem Anbieter "Mit {{provider}} anmelden", SSO-Fehlerbanner) |
| LoginMobile.dc.html | wie oben, `AuthLayout` < 720px | vollständig |
| Register.dc.html | `pages/SignupPage.tsx`, `/signup` | vollständig (Pflichtfelder mit "(Pflicht)" über `Field required`, Fehlersumme, "E-Mail bereits vergeben") |
| ConfirmEmail.dc.html | `pages/VerifyCodePage.tsx` (6-stelliger Code, `CodeInput`, "Erneut senden"), `/verify-email`; `pages/EmailVerifyPage.tsx` nur noch Ergebnis des Adresswechsel-Links | vollständig |
| ForgotPassword.dc.html | `pages/ForgotPasswordPage.tsx`, `/forgot-password` | vollständig (Paket 3): Formular, "Prüfe dein Postfach" mit der eingegebenen Adresse und "Andere E-Mail-Adresse eingeben"; Fehler/Netzwerk als Banner, 429 wie Erfolg (kein Orakel). Text "Der Link ist begrenzt gültig" konkret als "60 Minuten" |
| (ohne Artboard) Neues Passwort | `pages/ResetPasswordPage.tsx`, `/reset-password?token=` (GuestRoute) | neu, im Stil von AuthLayout/AuthStates: Formular (neues Passwort + Wiederholung, `PasswordField`), "Der Link ist ungültig oder abgelaufen" (fehlend/ungültig/benutzt/abgelaufen, mit "Neuen Link anfordern"), Erfolg (Banner + "Weiter zur Anmeldung"), Fehler-Banner. Token wird nach dem Lesen aus der Adresse entfernt (`replace`), `referrer: no-referrer` |
| AuthStates.dc.html | Bestätigungscode: `VerifyCodePage` (falscher Code, erneut senden, zu früh); Anmeldung: `LoginPage` + `FocusBanner` (falsche Zugangsdaten, E-Mail nicht bestätigt → Codeseite, Passkey fehlgeschlagen, SSO fehlgeschlagen) | vollständig |

## Erst-Einrichtung und Wechsel

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| Onboarding.dc.html | `pages/SetupPage.tsx` Schritt 1, `/setup`; `Stepper` | vollständig |
| OnboardingCalendar.dc.html | `SetupPage` Schritt 2 (`?clubId=`), Zeitzone "automatisch aus deinem Browser erkannt" | vollständig |
| OnboardingMobile.dc.html | `SetupPage` < 720px | vollständig |
| ClubPicker.dc.html | `pages/ClubsPage.tsx`, `components/clubs/ClubCard.tsx`, `/clubs` | vollständig (Zähler "n Kalender · n Mitglieder" aus `GET /api/clubs`, keine Requests je Verein; die Kalenderliste lädt erst beim Öffnen eines Vereins) |
| ContextSwitcher.dc.html | `layout/Sidebar.tsx`, `ContextMenu.tsx`, `ContextMenuItems.tsx` (Verein-/Kalendermenü, archivierte Kalender mit Archiv-Icon + "(archiviert)", Tastatur) | vollständig |
| ContextSwitcherMobile.dc.html | `layout/Topbar.tsx` + `ContextMenu` (mobiles Menü) | vollständig |
| Sidebar.dc.html | `layout/AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`, `Tabbar.tsx`, `navigation.ts` (aria-current, Tab-Zuordnung Import/Vorlagen → "Termine", Export → "Veröffentlichen") | vollständig |
| Menu.dc.html | `pages/MorePage.tsx`, `…/more` ("Du arbeitest in", Bereiche, Sprache, Abmelden) | vollständig |
| SettingsTabs.dc.html | `layout/SettingsTabs.tsx` | vollständig |

## Kalender

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| Calendar.dc.html | `pages/CalendarPage.tsx`, `…`; `calendar/CalendarToolbar` (Monat/Woche/Liste, Suche), `FilterBar` (Zielgruppen-Chips, aria-pressed), `SplitButton` "Termin anlegen", `MonthView`, `CalendarLegend`, FAB mobil | vollständig |
| MonthView.dc.html | `calendar/MonthView.tsx`, `MonthBoard.tsx` (Balken, mehrtägig, Feiertage), `DayPanel.tsx`, `EventChip.tsx`, `useGridKeyboard` | vollständig (Drag & Drop mit Rückgängig, nur wenn bearbeitbar) |
| CalendarWeek.dc.html | `calendar/WeekView.tsx`, `?view=week` | vollständig |
| CalendarStates.dc.html | `CalendarSkeleton` (aria-busy), Fehler-Banner mit "Erneut versuchen", Leerzustand, Suche ohne Treffer, Verschieben-Toasts (Erfolg + "Rückgängig", Fehler), "Termin gespeichert" | vollständig |
| CalendarArchived.dc.html | `CalendarPage` mit `archivedAt`: Banner "Archiviert, schreibgeschützt" + "Archivierung aufheben", Erfolgsbanner, StatusBadge archived, keine Anlegen-Aktionen | abweichend: der Kalender öffnet im aktuellen Monat mit "Heute"; das Design öffnet den archivierten Kalender in seinem Zeitraum (Okt. 2025) und beschriftet den Knopf "Zurück zu Oktober". Die Regel für den Startmonat ist im Design nicht festgelegt (offene Lücke L1) |
| CalendarMobile.dc.html | `MonthView` mobil (`MonthGrid` + Tagesliste mit `EventItem`), Tabbar, FAB | vollständig |

## Termine

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| Events.dc.html | `pages/events/EventsListPage.tsx`, `…/events` (Tabs mit Zähler, Suche, Ansicht-Umschalter, `EventsTable` mit Caption, Sammelaktionen über `POST …/events/bulk`, Mehrfach-Löschdialog) | vollständig (Sammelaktionen atomar: scheitert eine, ändert sich nichts und die Auswahl bleibt; OpenAPI `bulkEvents`) |
| EventsMobile.dc.html | `EventsListPage` < 720px: `EventItem`-Karten statt Tabelle, FAB | vollständig |
| EventsStates.dc.html | `EventsListPage`: Skeleton, Ladefehler, "Noch gar keine Termine", "Keine Treffer für „…“" | vollständig |
| EventNew.dc.html | `pages/events/EventNewModal.tsx`, `…/events/new` (Dialog / Bottom-Sheet) | vollständig |
| EventNewForm.dc.html | `pages/events/EventFormModal.tsx`, `…/events/new/form` ("Datum aus dem Kalender übernommen", Fehlersumme, Ort mit Karte) | vollständig |
| EventNewTemplate.dc.html | `pages/events/EventTemplatePickModal.tsx`, `…/events/new/template` (inkl. Leerzustand) | vollständig |
| EventSeries.dc.html | `pages/events/EventFromTemplateModal.tsx`, `…/events/new/template/:templateId` (Einzeltermin, Serienregel, Feiertage aussparen, Vorschau, Status, "n Termine als Entwurf anlegen") | vollständig (Paket 4): Vorschau vom Server (`POST …/events/series/preview`, entprellt; nicht im Design: Lade-, Fehler- mit "Erneut versuchen" und Obergrenzen-Zustand "höchstens 366 Termine", "Das Ende liegt vor dem Anfang."), "Serie anlegen" legt Serie und Termine atomar an (`POST …/events/series`), Toast "n Termine angelegt." |
| EventForm.dc.html | `EventFormModal`, `…/events/:eventId` (Entwurf/Veröffentlicht, Ort mit Karte + "Position korrigieren", Löschen, ungespeicherte Änderungen, schreibgeschützt im Archiv) | vollständig; Lösch-Dialog nach dem neueren Dialogs.dc.html ("Termin „…“ löschen?", "Der Termin am … wird dauerhaft entfernt.") statt der älteren Variante im Artboard ("Du löschst …"). Serientermine (Paket 4, nicht im Artboard): Tag "Wiederkehrend" im Kopf, Hinweis "Teil einer Terminreihe (n Termine)" mit Regeltext, Speichern/Löschen mit Serien-Dialog (siehe Dialogs); Aktion "Reihe ändern" am Hinweis (eigene Ergänzung, siehe nächste Zeile) |
| (ohne Artboard) Reihe ändern | `pages/events/EventSeriesEditModal.tsx`, `…/events/:eventId/series` (Schritt des Bearbeiten-Dialogs, gleicher `Modal`-Stil), Regel-Formular `components/events/SeriesRuleFields.tsx` (aus EventFromTemplateModal extrahiert, dort mitbenutzt) | **eigene Ergänzung, Wortlaut eigen** (im Design nicht vorhanden): Banner "Bisherige Regel" mit Regeltext und "Eine neue Regel ändert nur künftige Termine ab heute. Vergangene Termine bleiben, wie sie sind.", Abschnitt "Neue Regel", Abschnitt "Auswirkungen" mit Live-Region "n Termine kommen neu dazu. n künftige Termine werden gelöscht. n künftige Termine bleiben unverändert. n vergangene Termine bleiben, wie sie sind." und Listen "Diese n Termine werden gelöscht" (Datum, Name, Status) / "… kommen neu dazu"; Bestätigung per `ConfirmDialog` "Terminreihe ändern?" mit "Löscht n künftige Termine, legt m neue an. Vergangene Termine bleiben." (+ "nicht rückgängig" bei Löschungen; Fokus auf Abbrechen); Toast "Terminreihe geändert: m angelegt, n gelöscht."; Fehler 409 (inzwischen geändert, Vorschau lädt neu), 422 (Obergrenze 366 / keine Termine übrig), 403, Netzwerk als Banner im Dialog. Vorschau vom Server (`POST …/event-series/{id}/preview-update`), Änderung atomar (`PATCH …/event-series/{id}`) |
| EventFormMobile.dc.html | `EventFormModal` als Bottom-Sheet (`DialogFrame` < 720px) | vollständig |
| EventItem.dc.html | `calendar/EventItem.tsx` (Datumskachel, Zeit, Ort, Zielgruppen-Tags, Status als Wort, Eigenschafts-Emojis mit Text) | vollständig; Serientermine mit Tag "Wiederkehrend" (`Tag tone="brand"` aus Library.dc.html) vor den Zielgruppen, ebenso in der Terminliste (`EventsTable`, Spalte Name). Die Chips im Monatsraster tragen ihn nicht (MonthView.dc.html zeigt dort keinen) |
| Export.dc.html | `pages/events/EventsExportPage.tsx`, `…/events/export` (Zeitraum, Status, Zielgruppen, Vorschau, deaktivierter Download ohne Treffer, Download von `GET …/events.ics` mit JWT, Fehler-Banner) | vollständig (Datei aus dem Backend wie die Feeds: VTIMEZONE, Entwürfe als TENTATIVE; die Anzahl-Vorschau rechnet im Browser mit derselben Regel; Lade-/Fehlerzustand nicht im Design); Navigation markiert "Veröffentlichen" |

## Import und Vorlagen

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| Import.dc.html | `pages/ImportPage.tsx` Schritt "Datei", `components/import/ImportUpload.tsx` (Drop-Zone, "Datei wird gelesen …", falscher Typ / leer / unlesbar), `Stepper` | vollständig; Text des Hinweises "Serien werden einzeln übernommen" angepasst (Wiederholungen werden jetzt in Einzeltermine aufgelöst, höchstens 366 je Wiederholung, ohne Ende zwei Jahre) |
| ImportReview.dc.html | `import/ImportReview.tsx`, `ReviewGroup.tsx`, `ImportEditDialog.tsx` (Sammelpanel mit "Entwurf (voreingestellt)", Gruppen, Hinweise übersprungen / Wiederholung / Duplikate / Kodierung, Leiste "n von m ausgewählt") | vollständig (Duplikate, fehlerhafte Termine und ersetzte Zeitzonen aus `POST …/events/import/preview`, bei Fehler Name+Datum im Browser; zusätzlich, nicht im Design: Hinweise "Fehlerhaft" (mit "Fehlerhafte abwählen"), "Unbekannte Zeitzone wird ersetzt", Obergrenze 5000 je Import, "Termine werden geprüft …"); Text "Mehrere Orte" statt "Mehrere vorhandene Orte" (gemischte Gruppen können auch neue Orte enthalten). Wiederholungen (RRULE, eigene Ergänzung): statt "Wiederholungen werden nicht ausgeschrieben" Hinweis "Wiederholungen ausgeschrieben" ("n Wiederholungen ergeben m einzelne Termine … als Einzeltermine importiert, nicht als Terminreihe"), Warnungen "Wiederholung wird nicht unterstützt: nur der erste Termin wird importiert." und "Nicht alle Wiederholungen wurden ausgeschrieben" (ohne Ende / über 366 / Datei über 5000 mit Zahlen), im Gruppenkopf "Wiederholung (n Termine)", je Eintrag Badge "aus Wiederholung" bzw. "Wiederholung nicht unterstützt" |
| ImportReviewMobile.dc.html | `ImportReview` < 720px: Leiste über der Tabbar, Import-Button vor "Zurück", volle Breite | vollständig |
| ImportDone.dc.html | `import/ImportDone.tsx` (Zähler, neue Orte mit Namen aus `createdLocations`, "Import fehlgeschlagen" = nichts angelegt) | vollständig (atomarer Import: keine Teilerfolg-Ansicht mehr; zusätzlich übersprungene Doppelte und ersetzte Zeitzonen, Obergrenze als eigene Fehlermeldung) |
| Templates.dc.html | `pages/TemplatesPage.tsx`, `…/templates` (Karten, Suche, Leerzustand, "Termin aus Vorlage", Lösch-Dialog mit `eventCount`) | vollständig (Vorlage ohne Zeiten: "Ganztägig" statt der Uhrzeit, nicht im Design) |
| TemplateEdit.dc.html | `pages/TemplateEditPage.tsx`, `…/templates/new`, `…/templates/:templateId` (Zeitzone des Vereins / eigene, Zeiten optional und leer bei neuen Vorlagen, Pflichtfehler, Lösch-Dialog mit Anzahl erzeugter Termine, schreibgeschützt im Archiv) | vollständig (ohne Zeiten entstehen ganztägige Termine; Hinweis an der Endzeit) |

## Einstellungen

Kalender-Einstellungen (Name, Zeitzone, Eigenschaften, Features, Feiertagskalender, allgemein) und Club-Einstellungen (Orte, Zielgruppen, Feeds).

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| SettingsGeneral.dc.html | `pages/settings/CalendarSettingsPage.tsx`, `…/settings` (Name, Zeitzone, Hinweis "… findest du unter Verein verwalten") | vollständig |
| SettingsMasterList.dc.html | `components/settings/MasterList.tsx` (Anlegen, Umbenennen im `FormDialog`, Löschen mit Folgen, Leer/Laden/Fehler, schreibgeschützt) | vollständig; Lösch-Wortlaut nach Dialogs.dc.html |
| SettingsProps.dc.html | `PropertiesPage` → `MasterList kind="properties"` (+ `EmojiPicker`; Kalender-Ebene) | vollständig |
| SettingsFeatures.dc.html | `FeaturesPage` → `MasterList kind="features"` (Kalender-Ebene) | vollständig |
| SettingsAudiences.dc.html | `/clubs/:clubId/settings/target-groups` (`TargetGroupsPage` → `MasterList kind="audiences"`; Club-Ebene seit Paket 5) | vollständig |
| SettingsPlaces.dc.html | `/clubs/:clubId/settings/locations` (`pages/settings/LocationsPage.tsx`, `components/locations/*` mit Übersichtskarte mit Pins als Buttons, Liste mit "Auf Karte markiert", Formular mit Adresssuche, Koordinaten, Positionskarte, Lösch-Dialog; Club-Ebene seit Paket 5) | vollständig |
| SettingsPlacesMobile.dc.html | `LocationsPage` < 720px (Liste, Formular unter der Karte) | vollständig |
| SettingsHolidays.dc.html | `pages/settings/HolidayCalendarsPage.tsx`, `HolidayPreview.tsx` (Hinzufügen, Aktualisieren mit Busy-Label, Vorschau, Lösch-Dialog mit Anzahl; Kalender-Ebene) | vollständig |
| MapView.dc.html | `locations/PositionMap.tsx`, `LocationsOverviewMap.tsx`, `events/EventLocationMap.tsx`, öffentliche Terminansicht: statisches Kartenbild vom Backend (`PublicEventModal.tsx`, kein mapbox-gl; Textalternative) | vollständig |

## Veröffentlichen, Verein, Profil

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| Feeds.dc.html | `/clubs/:clubId/settings/feeds` (`pages/settings/FeedsPage.tsx`; Status als Wort + Icon, Zielgruppen, Adressen als `CopyField`, Lösch-Dialog; Club-Ebene seit Paket 5) | abweichend: lange Adressen statt kurzer Slugs `/k/<verein>/<feed>` (`BACKEND-GAPS.md`, Feeds); **drei Status statt zwei** (Entscheidung des Auftraggebers 2026-10-15, siehe unten "Feed-Status"): Badge "Öffentlich" (globe), "Nur per Link" (users, eigene Variante `club`), "Privat" (lock), dazu "Auffindbar" (search, Variante `searchable`) bei öffentlichen Feeds mit Suchmaschinen-Option; Adressen nur bei Privat mit `?secret=` |
| FeedEdit.dc.html | `pages/settings/FeedEditPage.tsx`, `…/settings/feeds/new`, `…/settings/feeds/:feedId` (Name, Sichtbarkeit, Zielgruppen, Geheimnis neu erzeugen, Löschen; Feed per Einzel-GET) | abweichend (Entscheidung des Auftraggebers): Radiogruppe "Sichtbarkeit" mit drei Optionen statt zwei (Öffentlich / Nur per Link / Privat (geschützt), je mit Erklärtext; Standard für neue Feeds Nur per Link statt Öffentlich), darunter nur bei "Öffentlich" der Schalter "Für Suchmaschinen auffindbar" (`Toggle`, Standard aus, Hilfetext); Speichern eines privaten Feeds als öffentlich/nur per Link fragt per `ConfirmDialog` ("Geheimnis nicht mehr verlangen?", Folgenhinweis). Wortlaut eigen (nicht im Design) |
| Club.dc.html | `pages/ClubPage.tsx`, `components/club/*`, `/clubs/:clubId` (Name, Mitglieder, Kalender anlegen/duplizieren/archivieren/löschen, archivierte Kalender, Verein löschen mit Namenseingabe) | vollständig (Kalenderzeile "n Termine" aus `eventCount`; Lösch-Dialoge mit den API-Zählern) |
| ClubMobile.dc.html | `ClubPage` < 720px (Karten statt Tabelle) | vollständig |
| Profile.dc.html | `pages/ProfilePage.tsx`, `components/profile/*`, `/profile` (Konto, Passkeys, verknüpfte Anmeldungen, Darstellung inkl. Theme-Schalter, Sprache, Konto löschen) | abweichend (Erweiterung, Paket 3): Verknüpfen/Trennen aktiv (Banner/Toast "Google wurde verknüpft.", "Die Verknüpfung mit … wurde getrennt.", `ConfirmDialog` mit Folgenhinweis, Trennen deaktiviert mit "Mindestens eine Anmeldemethode muss bleiben …", `?linked=`/`?link_error=` werden ausgewertet und aus der Adresse entfernt; `?link_provider=&link_proof=` schließt die Verknüpfung mit der eigenen Sitzung ab). Statt "Name und E-Mail können hier noch nicht geändert werden." zwei neue Panels im selben Stil (nicht im Design): `AccountSection` "Name und E-Mail-Adresse" (Name speichern; neue Adresse + aktuelles Passwort → Bestätigungslink, wartende Adresse als Banner mit "Änderung verwerfen"; SSO-only: Hinweis statt Formular) und `PasswordSection` "Passwort" (ändern mit aktuellem Passwort, diese Sitzung bleibt; SSO-only: "Passwort per E-Mail festlegen"). Passkeys zusätzlich "zuletzt benutzt am …" / "noch nicht benutzt" |
| ProfileMobile.dc.html | `ProfilePage` < 720px | vollständig |

## Öffentlicher Zugriff

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| Public.dc.html | `pages/FeedPage.tsx`, `/feed/:feedId`; `feed/PublicShell.tsx` (Skip-Link, LangSwitch, ThemeSwitch), Kopf mit Vereins- und Kalendername, Monat/Liste, Filter, Suche, Abo-Adressen, Zeitzonenhinweis und "heute" in der Zone aus der API, Feiertage im Monat, Laden je Monatsraster | vollständig (Feed-Name als Seitentitel; `noindex` per `<meta>` außer bei indexierbaren Feeds = öffentlich + "auffindbar", `feed.indexable`; auch nur per Link, privat und alle Fehlerzustände noindex) |
| PublicMobile.dc.html | `FeedPage` < 720px | vollständig |
| PublicEvent.dc.html | `pages/PublicEventModal.tsx`, `/feed/:feedId/events/:eventId` (Dialog über dem Feed, Untertitel "Verein · Kalender", Termin per Einzel-Endpoint, Karte + Textalternative, ICS-Datei in der Zone des Termins) | vollständig |
| PublicEventMobile.dc.html | `PublicEventModal` als Bottom-Sheet | vollständig |
| PublicStates.dc.html | `feed/PublicStates.tsx` (Laden, privat/Schlüssel fehlt, nicht gefunden, Ladefehler mit "Erneut versuchen") | vollständig; Ladefehler-Text "Deine Auswahl bleibt dabei erhalten" statt "Deine Eingaben gehen dabei nicht verloren" (Gäste haben keine Eingaben, nur Filter) |

## Fehlerzustände der Anwendung

Kein eigenes Artboard; Wortlaut und Optik nach PublicStates / CalendarStates (EmptyState + Banner, `AuthLayout`-Karte).

| Zustand | Umsetzung | Status |
| --- | --- | --- |
| Unbekannte URL (404), Chunk-/Ladefehler nach einem Deploy, unerwarteter Render-Fehler | `components/error/ErrorPage.tsx` (`errorElement` des Routers, Catch-All-Route, `AppErrorBoundary` in `main.tsx`), `lib/loadError.ts`; h1 mit Fokus, "Seite neu laden", "Zur Startseite", "Zurück" (404); Details nur in der Entwicklung; Notfalltext auf Deutsch ohne i18n; Reload-Schutz `lib/chunkReload.ts` (ein Reload pro Sitzung und Datei) | vollständig (ersetzt die Router-Standardseite "Unexpected Application Error!"; axe 0 Verstöße, 1440/390, hell/dunkel) |

## Bausteine

| Artboard | Umsetzung (`components/ui/shared/`) | Status |
| --- | --- | --- |
| Library.dc.html | Buttons (`Button`/`IconButton`: primary, secondary, ghost, danger, danger-solid, ghost-danger, Icon outline/danger), `Field` (Hilfe, Fehler, "(Pflicht)"/"(optional)"), `Toggle`, Filter-Chips (`FilterPillGroup`/`Chip`, aria-pressed), Tabs mit Zähler (`ap-tabs`/`ap-count`), `StatusBadge` (alle 8 Varianten), `Tag` (Töne youth/adult/senior, brand für "Wiederkehrend"), `EventItem`, `Banner`, `Toast`, `Skeleton`, `EmptyState`, `ConfirmDialog`, `CopyField`, `ChipSelect`, `EmojiPicker`, `Stepper`, `LangSwitch`, `Logo` (Vollform + Zeichen), MonthGrid (`calendar/MonthGrid`), MapView, Dateieingabe (`ImportUpload`), Suche (`SearchInput`/`ap-search`) | vollständig |
| Banner.dc.html | `Banner.tsx` (info, warning, danger, success) | vollständig |
| ChipSelect.dc.html | `ChipSelect.tsx` (Auswahl + Anlegen) | vollständig |
| ConfirmDialog.dc.html | `ConfirmDialog.tsx` (Icon, Text, Folgenhinweis, `requireText`, Ton primary/danger) | vollständig |
| CopyField.dc.html | `CopyField.tsx` (Kopieren-Feedback, Live-Region) | vollständig |
| Dialogs.dc.html | alle 16 Bestätigungsdialoge, siehe Tabelle unten, plus drei Serien-Dialoge | vollständig (3 Texte bewusst nach den Seiten-Artboards; Serien-Dialoge nicht im Design, Wortlaut eigen) |
| EmojiPicker.dc.html | `EmojiPicker.tsx` (Vorgaben, eigenes, emoji-mart lazy) | vollständig |
| EmptyState.dc.html | `EmptyState.tsx` | vollständig |
| Icon.dc.html / IconSheet.dc.html | `Icon.tsx`: alle 57 Glyphen des Designs auf lucide gemappt; keine Emojis als UI-Icons (Emojis nur als Eigenschafts-Symbole und im `EmojiPicker`) | vollständig |
| LangSwitch.dc.html | `LangSwitch.tsx` (i18next, de/en) | vollständig |
| StatusBadge.dc.html | `StatusBadge.tsx` | vollständig |
| Stepper.dc.html | `Stepper.tsx` | vollständig |
| Toast.dc.html | `Toast.tsx` (sonner, Ton, Aktion) | vollständig |

### Bestätigungsdialoge (Dialogs.dc.html)

| # | Dialog | Umsetzung | Wortlaut |
| --- | --- | --- | --- |
| 1 | Termin löschen | `EventFormModal` | wie Design |
| 2 | Mehrere Termine löschen | `EventsListPage` | wie Design (Liste "Name (TT.MM.)", Entwürfe-Variante) |
| 3 | Vorlage löschen | `TemplatesPage`, `TemplateEditPage` | nach Templates/TemplateEdit.dc.html ("Bereits aus dieser Vorlage erzeugte Termine bleiben unverändert."), mit `eventCount` als "Die 4 bereits aus dieser Vorlage erzeugten Termine bleiben unverändert." bzw. "Aus dieser Vorlage wurden noch keine Termine erzeugt."; Dialogs.dc.html formuliert "Nur die Vorlage wird gelöscht. Bereits erzeugte Termine bleiben unberührt." – Design in sich uneinheitlich |
| 4–6 | Eigenschaft / Feature / Zielgruppe löschen | `MasterList` | **angeglichen**: "Die Eigenschaft wird aus der Liste entfernt.", "Bei 2 Terminen (A, B) wird die Zuordnung entfernt. Die Termine selbst bleiben bestehen." (Namen bis 3 Termine, vom Backend in `usage.eventNames`), Zielgruppe: "… Feeds, die diese Zielgruppe ausgewählt haben, verlieren sie aus ihrer Auswahl." (nur wenn `usage.feeds` > 0). Zusätzlich (nicht im Design): "n Vorlagen verlieren die Zuordnung." Zähler aus der Liste (`usage`), keine Termin-/Vorlagenlisten |
| 7 | Ort löschen | `LocationsPage` | **angeglichen**: "Der Ort wird samt Kartenposition entfernt.", "n Termine mit diesem Ort haben danach keinen Ort mehr. Die Vorlage „…“ verliert ihren Standardort." (Zähler und Vorlagenname aus `usage`) |
| 8 | Feiertagskalender löschen | `HolidayCalendarsPage` | **angeglichen**: "Die 16 Feiertage verschwinden aus dem Kalender und lassen sich in Serien nicht mehr aussparen. Die Quelle im Internet bleibt unverändert." |
| 9 | Feed löschen | `FeedsPage`, `FeedEditPage` | wie Design |
| 10 | Geheimnis neu erzeugen | `FeedEditPage` | **angeglichen**: "Der Feed „…“ bekommt ein neues Geheimnis und damit neue Adressen." |
| 11 | Kalender archivieren | `CalendarsSection` | **angeglichen**: "Der Kalender wandert in die Liste der archivierten Kalender." + "Der Kalender ist danach gesperrt: …"; bewusst ergänzt: "Seine Feeds liefern bis dahin keine Termine mehr." (archivierte Kalender antworten im Feed mit 404, OpenAPI, öffentlicher Feed) |
| 12 | Kalender löschen | `CalendarDeleteDialog` | **angeglichen**: "Der Kalender wird dauerhaft gelöscht.", "Löscht den Kalender mit allen 6 Terminen und seinen Feeds unwiderruflich. …" (`eventCount` per Einzel-GET); archiviert nach Club.dc.html deleteArchived |
| 13 | Mitglied entfernen | `MembersSection` | wie Design |
| 14 | Passkey entfernen | `PasskeysSection` | nach Profile.dc.html (mit Gerätename im Text) |
| 15 | Verein verlassen | `MembersSection` | wie Design (+ Variante "letztes Mitglied") |
| 1a | Serientermin löschen (nicht im Design) | `EventFormModal` | eigen, im Stil von 1: "Termin „…“ löschen?", "Der Termin am … gehört zu einer Terminreihe mit n Terminen.", Folgen wie 1; Aktionen "Abbrechen" (Fokus) / "Nur diesen Termin" / "Alle Termine der Reihe" (`ConfirmDialog` `alternative`) |
| 1b | Serientermin speichern (nicht im Design) | `EventFormModal` | eigen: "Änderungen für die Terminreihe speichern?", "„…“ gehört zu einer Terminreihe mit n Terminen. Für welche Termine sollen die Änderungen gelten?", Folgenhinweis "Bei „Alle Termine der Reihe“ übernehmen alle Termine die geänderten Angaben. Was du nicht geändert hast, bleibt …" und bei Datumsänderung "Das geänderte Datum gilt nur für diesen Termin. …"; nur wenn etwas geändert wurde |
| 1c | Terminreihe ändern (nicht im Design) | `EventSeriesEditModal` | eigen: "Terminreihe ändern?", "Die Regel von „…“ wird für alle künftigen Termine geändert.", Folgen "Löscht n künftige Termine, legt m neue an. Vergangene Termine bleiben." (+ "… lässt sich nicht rückgängig machen." bei Löschungen; ohne Löschungen `tone="primary"`); "Abbrechen" (Fokus) / "Reihe ändern" |
| 16 | Verein löschen | `ClubPage` | wie Design (Namenseingabe), Folgenhinweis mit Umfang aus `GET /api/clubs/:id`: "Löscht den Verein mit 2 Kalendern, 14 Terminen und 2 Feeds sowie allen Vorlagen unwiderruflich. Alle Mitglieder verlieren den Zugriff." (ohne Zähler der Design-Text) |

## Tokens und Styling

| Punkt | Umsetzung | Status |
| --- | --- | --- |
| `cc-tokens.css` hell + dunkel | `index.css` (`:root`/`[data-theme="dark"]`), Werte identisch (maschinell verglichen) | vollständig |
| Typografie Figtree, `t-display/h1/h2/h3/body/sm/label/cap` | `@fontsource-variable/figtree`, Klassen in `index.css` mit Design-Werten inkl. Mobil-Größen | vollständig |
| Radien, Abstände, Schatten | Tokens `--radius-*`, `--space-*`, `--shadow-*` | vollständig |
| Tap-Ziele 44px | `--tap-min`, `min-h-tap`/`size-tap`, `cc-btn` | vollständig |
| Fokus-Ring 3px | `:focus-visible { outline: 3px solid var(--brand) }` | vollständig |
| Skip-Link | `AppShell`, `AuthLayout`, `PublicShell` | vollständig |

## Behobene Lücken (diese Prüfung)

Aus dem abgebrochenen Vorlauf übernommen (geprüft, design-gedeckt, getestet, de/en gleich):
1. Export-Seite gehört zu "Veröffentlichen" (Export.dc.html: `Sidebar active="feeds"`) – `layout/navigation.ts`, Tests in `Sidebar.test.tsx`.
2. Feiertagskalender löschen: Folgenhinweis mit Anzahl nach Dialogs.dc.html – `HolidayCalendarsPage.tsx`, Test.
3. Aktualisieren-Button: Name "… wird aktualisiert" während des Ladens (SettingsHolidays.dc.html `refreshLabel`) – Test.
4. Import-Prüfung mobil: Import-Button vor "Zurück" (ImportReview.dc.html, `ap-show-m`) – `ImportReview.tsx`, Test.
5. Orte: markierte Zeile bekam keine Klasse `ap-listrow--current` (fehlendes Leerzeichen) – `LocationsPage.tsx`, Test.

Neu:
6. Kalender archivieren: Wortlaut nach Club.dc.html / Dialogs.dc.html – `de/en.json`, Tests `ClubPage.test.tsx`, E2E `club.spec.ts`.
7. Kalender löschen: Wortlaut und Umfang (Anzahl Termine) nach Club.dc.html / Dialogs.dc.html, archiviert ohne Zählung – `CalendarDeleteDialog.tsx`, Tests.
8. Eigenschaft / Feature / Zielgruppe / Ort löschen und Geheimnis neu erzeugen: Wortlaut nach Dialogs.dc.html (Terminnamen, Vorlagenname, Feed-Name, Feeds bei Zielgruppen) – `MasterList.tsx`, `LocationsPage.tsx`, `FeedEditPage.tsx`, `lib/settings/masterList.ts` (`affectedEventNames`, `locationTemplateNames`), Tests (Vitest + E2E `settings.spec.ts`).
9. Import-Sammelpanel: "Entwurf (voreingestellt)" (ImportReview.dc.html) – `StatusSeg` (`draftLabel`), `ImportReview.tsx`, Test.

Nebenbefund (kein Design-Thema, nötig für eine stabile E2E-Suite):
10. `lib/AuthProvider.tsx` löschte die Tokens bei jedem Fehler von `GET /api/auth/me`, auch wenn der Browser die
    Anfrage beim Verlassen der Seite abbrach (Neuladen, neue Adresse): die nächste Seite landete dann auf `/login`
    (reproduzierbar in `e2e/regressions.spec.ts` "Vereinswechsel …"). Jetzt beendet nur eine Serverantwort (`ApiError`)
    die Sitzung; abgelehnte Sitzungen (401) räumt wie bisher `lib/api.ts` ab. Test `lib/__tests__/AuthProvider.test.tsx`.

## Offene Lücken

L2 (Passwort vergessen: "Prüfe dein Postfach") und L4 (Verknüpfen/Trennen inkl. Toasts und Schutzhinweis) sind mit
Paket 3 erledigt, L3 (Terminserien anlegen, Serien-Dialoge) mit Paket 4 (siehe EventSeries, EventForm, Dialogs oben).

| # | Lücke | Artboard | Aufwand | Grund |
| --- | --- | --- | --- | --- |
| L1 | Archivierter Kalender öffnet im eigenen Zeitraum, Knopf "Zurück zu <Monat>" statt "Heute" | CalendarArchived | klein–mittel | Regel für den Startmonat fehlt im Design (letzter Termin? Archivierungsdatum?); Entscheidung nötig |
| L5 | Kurze Feed-Adressen (`/k/<verein>/<feed>`) | Feeds | klein (Frontend) + Backend | keine Slugs im API ("n Termine" und der öffentliche Kopf sind seit Paket 1 umgesetzt) |
| L6 | Passkey-Dialog-Text ohne Namen (Dialogs) vs. mit Namen (Profile), Vorlagen-Dialog zwei Fassungen | Dialogs / Profile / Templates | – | Design uneinheitlich, Umsetzung folgt den Seiten-Artboards; Klärung im Design |

## Feed-Status (2026-10-15, Abweichung vom Design)

Das Design kennt zwei Sichtbarkeiten (öffentlich / privat). Auf Entscheidung des Auftraggebers gibt es drei Status:
**Öffentlich** (`PUBLIC`), **Nur per Link** (`CLUB`, Standard für neue Feeds) und **Privat (geschützt)**
(`PRIVATE`). Öffentlich und Nur per Link sind ohne Geheimnis per Link erreichbar und unterscheiden sich nur in der
Suchmaschinen-Anweisung; nur öffentliche Feeds haben die Option "Für Suchmaschinen auffindbar" (Opt-in). Umsetzung:
`FeedEditPage` (Radiogruppe, Schalter, Bestätigung beim Wechsel von Privat), `FeedsPage` (`StatusBadge` `public` /
`club` / `private` + `searchable`), `usePublicHead` (`indexable`). Backend, Migration und Robots-Logik:
`docs/api/openapi.yaml` (Feeds).
