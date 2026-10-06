# Design-Abdeckung (Phase 9a)

Stand: 2026-10-06. Quelle: Design-Artifact (lokal `…/artifact-files/469a6604-…/project/`, 72 Artboards laut
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

- 72 Artboards: **64 vollständig**, **8 abweichend** (bewusst, begründet), **0 offene Lücken in der Zuordnung**.
  Offene Teil-Lücken innerhalb abweichender Artboards: siehe "Offene Lücken".
- In dieser Prüfung behoben: 9 Design-Punkte (siehe "Behobene Lücken"), davon 5 aus dem abgebrochenen Vorlauf übernommen, plus ein Nebenbefund (Sitzung beim Seitenwechsel).

## Zugang

| Artboard | Umsetzung (Datei / Route) | Status |
| --- | --- | --- |
| Main.dc.html (Anmeldung) | `pages/LoginPage.tsx`, `/login`; `components/auth/AuthLayout.tsx` (Logo, LangSwitch, Skip-Link) | vollständig (E-Mail/Passwort, Passkey, SSO-Buttons je konfiguriertem Anbieter "Mit {{provider}} anmelden", SSO-Fehlerbanner) |
| LoginMobile.dc.html | wie oben, `AuthLayout` < 720px | vollständig |
| Register.dc.html | `pages/SignupPage.tsx`, `/signup` | vollständig (Pflichtfelder mit "(Pflicht)" über `Field required`, Fehlersumme, "E-Mail bereits vergeben") |
| ConfirmEmail.dc.html | `pages/EmailVerifyPage.tsx` (ohne `status`: "Bestätige deine E-Mail-Adresse" + erneut senden), `/auth/verify-email` | vollständig |
| ForgotPassword.dc.html | `pages/ForgotPasswordPage.tsx`, `/forgot-password` | abweichend: Absenden deaktiviert ("Bald verfügbar"), Zustand "Prüfe dein Postfach" fehlt – kein Reset-Endpoint (BACKEND-GAPS Phase 1) |
| AuthStates.dc.html | Bestätigungslink: `EmailVerifyPage` (erfolgreich / abgelaufen / schon benutzt / ungültig); Anmeldung: `LoginPage` + `FocusBanner` (falsche Zugangsdaten, E-Mail nicht bestätigt mit "erneut senden" + "Bestätigungsmail gesendet", Passkey fehlgeschlagen, SSO fehlgeschlagen) | vollständig |

## Erst-Einrichtung und Wechsel

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| Onboarding.dc.html | `pages/SetupPage.tsx` Schritt 1, `/setup`; `Stepper` | vollständig |
| OnboardingCalendar.dc.html | `SetupPage` Schritt 2 (`?clubId=`), Zeitzone "automatisch aus deinem Browser erkannt" | vollständig |
| OnboardingMobile.dc.html | `SetupPage` < 720px | vollständig |
| ClubPicker.dc.html | `pages/ClubsPage.tsx`, `components/clubs/ClubCard.tsx`, `/clubs` | vollständig (Zähler "n Kalender · n Mitglieder" über N+1-Requests, BACKEND-GAPS Phase 2) |
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
| Events.dc.html | `pages/events/EventsListPage.tsx`, `…/events` (Tabs mit Zähler, Suche, Ansicht-Umschalter, `EventsTable` mit Caption, Sammelaktionen, Mehrfach-Löschdialog) | vollständig (Sammelaktionen als Einzel-Requests, BACKEND-GAPS Phase 4) |
| EventsMobile.dc.html | `EventsListPage` < 720px: `EventItem`-Karten statt Tabelle, FAB | vollständig |
| EventsStates.dc.html | `EventsListPage`: Skeleton, Ladefehler, "Noch gar keine Termine", "Keine Treffer für „…“" | vollständig |
| EventNew.dc.html | `pages/events/EventNewModal.tsx`, `…/events/new` (Dialog / Bottom-Sheet) | vollständig |
| EventNewForm.dc.html | `pages/events/EventFormModal.tsx`, `…/events/new/form` ("Datum aus dem Kalender übernommen", Fehlersumme, Ort mit Karte) | vollständig |
| EventNewTemplate.dc.html | `pages/events/EventTemplatePickModal.tsx`, `…/events/new/template` (inkl. Leerzustand) | vollständig |
| EventSeries.dc.html | `pages/events/EventFromTemplateModal.tsx`, `…/events/new/template/:templateId` (Einzeltermin, Serienregel, Feiertage aussparen, Vorschau) | abweichend: "Serie anlegen" deaktiviert ("Bald verfügbar"), Serien fehlen im Backend (BACKEND-GAPS Phase 4) |
| EventForm.dc.html | `EventFormModal`, `…/events/:eventId` (Entwurf/Veröffentlicht, Ort mit Karte + "Position korrigieren", Löschen, ungespeicherte Änderungen, schreibgeschützt im Archiv) | vollständig; Lösch-Dialog nach dem neueren Dialogs.dc.html ("Termin „…“ löschen?", "Der Termin am … wird dauerhaft entfernt.") statt der älteren Variante im Artboard ("Du löschst …") |
| EventFormMobile.dc.html | `EventFormModal` als Bottom-Sheet (`DialogFrame` < 720px) | vollständig |
| EventItem.dc.html | `calendar/EventItem.tsx` (Datumskachel, Zeit, Ort, Zielgruppen-Tags, Status als Wort, Eigenschafts-Emojis mit Text) | vollständig |
| Export.dc.html | `pages/events/EventsExportPage.tsx`, `…/events/export` (Zeitraum, Status, Zielgruppen, Vorschau, deaktivierter Download ohne Treffer) | abweichend: ICS wird im Browser gebaut (kein Export-Endpoint, BACKEND-GAPS Phase 4); Navigation markiert "Veröffentlichen" |

## Import und Vorlagen

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| Import.dc.html | `pages/ImportPage.tsx` Schritt "Datei", `components/import/ImportUpload.tsx` (Drop-Zone, "Datei wird gelesen …", falscher Typ / leer / unlesbar), `Stepper` | vollständig |
| ImportReview.dc.html | `import/ImportReview.tsx`, `ReviewGroup.tsx`, `ImportEditDialog.tsx` (Sammelpanel mit "Entwurf (voreingestellt)", Gruppen, Hinweise übersprungen / Wiederholung / Duplikate / Kodierung, Leiste "n von m ausgewählt") | vollständig (Prüfung clientseitig, BACKEND-GAPS Phase 5); Text "Mehrere Orte" statt "Mehrere vorhandene Orte" (gemischte Gruppen können auch neue Orte enthalten) |
| ImportReviewMobile.dc.html | `ImportReview` < 720px: Leiste über der Tabbar, Import-Button vor "Zurück", volle Breite | vollständig |
| ImportDone.dc.html | `import/ImportDone.tsx` (Zähler, neue Orte mit Namen, Teilerfolg) | vollständig |
| Templates.dc.html | `pages/TemplatesPage.tsx`, `…/templates` (Karten, Suche, Leerzustand, "Termin aus Vorlage", Lösch-Dialog) | vollständig |
| TemplateEdit.dc.html | `pages/TemplateEditPage.tsx`, `…/templates/new`, `…/templates/:templateId` (Zeitzone des Vereins / eigene, Pflichtfehler, Lösch-Dialog, schreibgeschützt im Archiv) | abweichend: Zeiten sind Pflicht (Backend verlangt sie, BACKEND-GAPS Phase 5) |

## Kalender-Einstellungen

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| SettingsGeneral.dc.html | `pages/settings/CalendarSettingsPage.tsx`, `…/settings` (Name, Zeitzone, Hinweis "… findest du unter Verein verwalten") | vollständig |
| SettingsMasterList.dc.html | `components/settings/MasterList.tsx` (Anlegen, Umbenennen im `FormDialog`, Löschen mit Folgen, Leer/Laden/Fehler, schreibgeschützt) | vollständig; Lösch-Wortlaut nach Dialogs.dc.html |
| SettingsProps.dc.html | `PropertiesPage` → `MasterList kind="properties"` (+ `EmojiPicker`) | vollständig |
| SettingsFeatures.dc.html | `FeaturesPage` → `MasterList kind="features"` | vollständig |
| SettingsAudiences.dc.html | `TargetGroupsPage` → `MasterList kind="audiences"` | vollständig |
| SettingsPlaces.dc.html | `pages/settings/LocationsPage.tsx`, `components/locations/*` (Übersichtskarte mit Pins als Buttons, Liste mit "Auf Karte markiert", Formular mit Adresssuche, Koordinaten, Positionskarte, Lösch-Dialog) | vollständig |
| SettingsPlacesMobile.dc.html | `LocationsPage` < 720px (Liste, Formular unter der Karte) | vollständig |
| SettingsHolidays.dc.html | `pages/settings/HolidayCalendarsPage.tsx`, `HolidayPreview.tsx` (Hinzufügen, Aktualisieren mit Busy-Label, Vorschau, Lösch-Dialog mit Anzahl) | vollständig |
| MapView.dc.html | `locations/PositionMap.tsx`, `LocationsOverviewMap.tsx`, `events/EventLocationMap.tsx`, `feed/PublicEventMap.tsx` (Karte + Textalternative, `MapBoundary`) | vollständig |

## Veröffentlichen, Verein, Profil

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| Feeds.dc.html | `pages/settings/FeedsPage.tsx`, `…/settings/feeds` (Sichtbarkeit als Wort + Icon, Zielgruppen, Adressen als `CopyField`, Lösch-Dialog) | abweichend: lange Adressen statt kurzer Slugs `/k/<verein>/<feed>` (BACKEND-GAPS Phase 7) |
| FeedEdit.dc.html | `pages/settings/FeedEditPage.tsx`, `…/settings/feeds/new`, `…/settings/feeds/:feedId` (Name, öffentlich/privat, Zielgruppen, Geheimnis neu erzeugen, Löschen) | vollständig |
| Club.dc.html | `pages/ClubPage.tsx`, `components/club/*`, `/clubs/:clubId` (Name, Mitglieder, Kalender anlegen/duplizieren/archivieren/löschen, archivierte Kalender, Verein löschen mit Namenseingabe) | abweichend: Kalenderzeile zeigt die Zeitzone statt "n Termine" (kein Zähler, BACKEND-GAPS Phase 7) |
| ClubMobile.dc.html | `ClubPage` < 720px (Karten statt Tabelle) | vollständig |
| Profile.dc.html | `pages/ProfilePage.tsx`, `components/profile/*`, `/profile` (Konto, Passkeys, verknüpfte Anmeldungen, Darstellung inkl. Theme-Schalter, Sprache, Konto löschen) | abweichend: Verknüpfen/Trennen deaktiviert ("Bald verfügbar"), daher entfallen die Toasts "Die Verknüpfung mit … wurde verknüpft" und der Hinweis "Mindestens eine Anmeldemethode muss bleiben" (BACKEND-GAPS Phase 7) |
| ProfileMobile.dc.html | `ProfilePage` < 720px | vollständig |

## Öffentlicher Zugriff

| Artboard | Umsetzung | Status |
| --- | --- | --- |
| Public.dc.html | `pages/FeedPage.tsx`, `/feed/:feedId`; `feed/PublicShell.tsx` (Skip-Link, LangSwitch, ThemeSwitch), Monat/Liste, Filter, Suche, Abo-Adressen, Zeitzonenhinweis | vollständig (Kopf nur mit Feed-Namen, Vereins-/Kalendername fehlen im API, BACKEND-GAPS Phase 8) |
| PublicMobile.dc.html | `FeedPage` < 720px | vollständig |
| PublicEvent.dc.html | `pages/PublicEventModal.tsx`, `/feed/:feedId/events/:eventId` (Dialog über dem Feed, Karte + Textalternative, ICS-Datei) | vollständig |
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
| Library.dc.html | Buttons (`Button`/`IconButton`: primary, secondary, ghost, danger, danger-solid, ghost-danger, Icon outline/danger), `Field` (Hilfe, Fehler, "(Pflicht)"/"(optional)"), `Toggle`, Filter-Chips (`FilterPillGroup`/`Chip`, aria-pressed), Tabs mit Zähler (`ap-tabs`/`ap-count`), `StatusBadge` (alle 8 Varianten), `Tag` (Töne youth/adult/senior), `EventItem`, `Banner`, `Toast`, `Skeleton`, `EmptyState`, `ConfirmDialog`, `CopyField`, `ChipSelect`, `EmojiPicker`, `Stepper`, `LangSwitch`, `Logo` (Vollform + Zeichen), MonthGrid (`calendar/MonthGrid`), MapView, Dateieingabe (`ImportUpload`), Suche (`SearchInput`/`ap-search`) | vollständig |
| Banner.dc.html | `Banner.tsx` (info, warning, danger, success) | vollständig |
| ChipSelect.dc.html | `ChipSelect.tsx` (Auswahl + Anlegen) | vollständig |
| ConfirmDialog.dc.html | `ConfirmDialog.tsx` (Icon, Text, Folgenhinweis, `requireText`, Ton primary/danger) | vollständig |
| CopyField.dc.html | `CopyField.tsx` (Kopieren-Feedback, Live-Region) | vollständig |
| Dialogs.dc.html | alle 16 Bestätigungsdialoge, siehe Tabelle unten | vollständig (3 Texte bewusst nach den Seiten-Artboards) |
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
| 3 | Vorlage löschen | `TemplatesPage`, `TemplateEditPage` | nach Templates/TemplateEdit.dc.html ("Bereits aus dieser Vorlage erzeugte Termine bleiben unverändert."); Dialogs.dc.html formuliert "Nur die Vorlage wird gelöscht. Bereits erzeugte Termine bleiben unberührt." – Design in sich uneinheitlich |
| 4–6 | Eigenschaft / Feature / Zielgruppe löschen | `MasterList` | **angeglichen**: "Die Eigenschaft wird aus der Liste entfernt.", "Bei 2 Terminen (A, B) wird die Zuordnung entfernt. Die Termine selbst bleiben bestehen." (Namen bis 3 Termine), Zielgruppe: "… Feeds, die diese Zielgruppe ausgewählt haben, verlieren sie aus ihrer Auswahl." Zusätzlich (nicht im Design): "n Vorlagen verlieren die Zuordnung." |
| 7 | Ort löschen | `LocationsPage` | **angeglichen**: "Der Ort wird samt Kartenposition entfernt.", "n Termine mit diesem Ort haben danach keinen Ort mehr. Die Vorlage „…“ verliert ihren Standardort." |
| 8 | Feiertagskalender löschen | `HolidayCalendarsPage` | **angeglichen**: "Die 16 Feiertage verschwinden aus dem Kalender und lassen sich in Serien nicht mehr aussparen. Die Quelle im Internet bleibt unverändert." |
| 9 | Feed löschen | `FeedsPage`, `FeedEditPage` | wie Design |
| 10 | Geheimnis neu erzeugen | `FeedEditPage` | **angeglichen**: "Der Feed „…“ bekommt ein neues Geheimnis und damit neue Adressen." |
| 11 | Kalender archivieren | `CalendarsSection` | **angeglichen**: "Der Kalender wandert in die Liste der archivierten Kalender." + "Der Kalender ist danach gesperrt: …"; bewusst ergänzt: "Seine Feeds liefern bis dahin keine Termine mehr." (archivierte Kalender antworten im Feed mit 404, BACKEND-GAPS Phase 8) |
| 12 | Kalender löschen | `CalendarDeleteDialog` | **angeglichen**: "Der Kalender wird dauerhaft gelöscht.", "Löscht den Kalender mit allen 6 Terminen und seinen Feeds unwiderruflich. …"; archiviert nach Club.dc.html deleteArchived |
| 13 | Mitglied entfernen | `MembersSection` | wie Design |
| 14 | Passkey entfernen | `PasskeysSection` | nach Profile.dc.html (mit Gerätename im Text) |
| 15 | Verein verlassen | `MembersSection` | wie Design (+ Variante "letztes Mitglied") |
| 16 | Verein löschen | `ClubPage` | wie Design (Namenseingabe) |

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

| # | Lücke | Artboard | Aufwand | Grund |
| --- | --- | --- | --- | --- |
| L1 | Archivierter Kalender öffnet im eigenen Zeitraum, Knopf "Zurück zu <Monat>" statt "Heute" | CalendarArchived | klein–mittel | Regel für den Startmonat fehlt im Design (letzter Termin? Archivierungsdatum?); Entscheidung nötig |
| L2 | Passwort vergessen: Zustand "Prüfe dein Postfach" | ForgotPassword | mittel (+ Backend) | kein Reset-Endpoint |
| L3 | Terminserien anlegen / Serien-Dialoge | EventSeries | groß (+ Backend) | keine Serien im Backend |
| L4 | Verknüpfte Anmeldungen verknüpfen/trennen inkl. Toasts und Schutzhinweis | Profile | mittel (+ Backend) | keine Endpoints |
| L5 | Kalenderzeile "n Termine", Vereins-/Kalendername im öffentlichen Kopf, kurze Feed-Adressen | Club, Public, Feeds | klein (Frontend) + Backend | fehlende Felder/Slugs im API |
| L6 | Passkey-Dialog-Text ohne Namen (Dialogs) vs. mit Namen (Profile), Vorlagen-Dialog zwei Fassungen | Dialogs / Profile / Templates | – | Design uneinheitlich, Umsetzung folgt den Seiten-Artboards; Klärung im Design |
