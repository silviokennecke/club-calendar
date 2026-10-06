# Redesign: Umsetzungsplan

**Status: abgeschlossen (2026-10-06).** Alle Phasen 0–9 sind umgesetzt und committet. Ergebnis und Abweichungen
je Artboard: [`COVERAGE.md`](COVERAGE.md); offene Backend-Features, Sicherheitsrisiken, behobene Backend-Bugs und
Betriebshinweise: [`BACKEND-GAPS.md`](BACKEND-GAPS.md); isolierte E2E-Umgebung: [`E2E.md`](E2E.md). Technische
Konventionen des Frontends: `frontend/AGENTS.md`.

Design-Quelle (lokal, read-only): `/private/tmp/claude-501/-Users-kennecke-Projekte-club-calendar/249ab72f-78af-4214-aee9-b848532c1a40/scratchpad/artifact-files/469a6604-8239-4c15-ad1c-a7d2c0c6b5df/project/`
(`*.dc.html` = ein Artboard je Datei, `cc-tokens.css` + `cc-app.css` + `ds/clubcalendar/` = Styling, `Library.dc.html` = Bausteine, `canvas.json` = Index). Online: https://claude.ai/artifact/9ifcRDUWZSMTWMUGLDUWaz

## Entscheidungen (vom Auftraggeber bestätigt)
- Backend nur bei echten Bugs ändern. Fehlende Features -> `docs/redesign/BACKEND-GAPS.md` (fortlaufend ergänzen).
- Features ohne Backend (Passwort vergessen, Terminserien, ggf. Export): UI bauen, Aktion deaktiviert mit Hinweis "Bald verfügbar".
- Theme: System-Vorgabe + Schalter im Profil (Hell/Dunkel/System), in localStorage. Tokens aus `cc-tokens.css` (`data-theme="dark"` an `<html>`).
- Sprachen: de + en behalten. Alle neuen Texte als i18n-Keys (de aus Design, en übersetzt). LangSwitch aus dem Design einbauen.
- URLs/Routen der bestehenden App bleiben, außer das Design verlangt einen neuen Schritt.
- FullCalendar wird durch eigene Monats-/Wochenansicht ersetzt (Design: MonthView, CalendarWeek). Danach Abhängigkeit entfernen.
- Barrierefreiheit: echte `button`/`a`/`label`, `aria-current`, `aria-pressed`, Skip-Link, Fokus sichtbar, Tap-Ziele >= 44px, Status nie nur über Farbe, Kontrast aus Tokens.
- Modularität: wiederverwendbare Bausteine in `frontend/src/components/ui/shared/` (Export über `index.ts`), seitenspezifisches in `components/<bereich>/`. Keine Duplikate, vor dem Bauen prüfen.

## Phasen (je Phase: 1 Implementierungs-Agent, 1 Verifikations-Agent, danach Commit)
- [x] 0. Fundament (Opus): Tokens/CSS/Figtree, Tailwind-Mapping, ThemeProvider, Basis-Bausteine (Button, Field, Toggle, Tag, StatusBadge, Banner, EmptyState, ConfirmDialog, CopyField, ChipSelect, EmojiPicker, Stepper, LangSwitch, Logo, Toast, Skeleton), AppShell (Sidebar, Topbar, Tabbar, Kontextwechsel, Menu mobil). – `1a366b5`
- [x] 1. Zugang (Sonnet): Login, Registrierung, E-Mail bestätigen, Passwort vergessen (deaktiviert), Fehlerzustände, SSO-Callback. – `fd2d4e5`
- [x] 2. Einrichtung und Wechsel (Sonnet): Vereinsauswahl, Onboarding (Stepper Verein, Kalender), Kontextwechsel. – `15ae503`
- [x] 3. Kalender (Opus): eigene Monats- und Wochenansicht, Filter, Suche, archivierter Kalender, Zustände, mobil; FullCalendar entfernt. – `c71bbc2`
- [x] 4. Termine (Opus): Liste, Neu-Auswahl, Formular, Aus Vorlage, Serie (deaktiviert), Export, Dialoge. Neu-Auswahl bis Bearbeiten sind Modals über Kalender/Liste (siehe Korrektur unten). – `7e7c894`, Modals `044de50`
- [x] 5. Import und Vorlagen (Sonnet): Import, Review, Fertig, Vorlagenliste, Vorlage bearbeiten. – `d8367b0`
- [x] 6. Einstellungen (Sonnet): Allgemein, Eigenschaften, Features, Zielgruppen, Orte (Karte), Feiertage. – `82b1932`
- [x] 7. Veröffentlichen, Verein, Profil (Sonnet): Feeds, FeedEdit, Verein verwalten, Profil inkl. Theme-Schalter. – `15fda52`
- [x] 8. Öffentlicher Zugriff (Sonnet): Public-Feed, Termin-Detail (Modal über dem Feed), Zustände. – `e251aba`, Modal `044de50`
- [x] 9. Abschluss (Opus): 9a Design-Abdeckung (`COVERAGE.md`, `158d9f8`); 9b Aufräumen (tote i18n-Keys, CSS-Regeln und Exporte, Legacy-Helfer aus dem Barrel; die ungenutzten shadcn-Dateien in `components/ui/` und die Legacy-Dateien `SectionHeader`/`ListCard`/`ListRow` sind zur Löschung vorgemerkt), Route-Level-Code-Splitting, E2E komplett, CLAUDE.md/AGENTS.md aktualisiert, Backend-Lücken finalisiert (`BACKEND-GAPS.md`).

Zwischen den Phasen: Backend-Bugfixes `b6537e7`, `eaa9831`, `7b218c2`, Sicherheit `fe1dc8c`, `9cc6f10`;
Frontend-Nacharbeiten `1fe0b7f`, `a46d31a` (Details in `BACKEND-GAPS.md`).

## Abweichungen vom ursprünglichen Plan
- Termine sind Modals statt Seiten (Korrektur unten), der öffentliche Termin ebenso.
- Data Router (`createBrowserRouter` mit einer Splat-Route) statt `BrowserRouter`, damit ungespeicherte Änderungen
  auch den Zurück-Button des Browsers abfangen (`useBlocker`).
- Features ohne Backend sind gebaut, aber deaktiviert ("Bald verfügbar"): Passwort vergessen, Terminserien,
  SSO verknüpfen/trennen; Export und Import-Prüfung laufen im Browser. Bewusste Abweichungen je Artboard und
  offene Punkte L1–L6: `COVERAGE.md`.
- Backend wurde über echte Bugs hinaus in einer Sicherheits-Runde geändert (Passkeys, OAuth-State,
  Konto-Verknüpfung, Sitzungs-Invalidierung), vom Auftraggeber beauftragt.

## Korrektur Phase 4 und 8: Termine sind Modals
- Termin anlegen (Auswahl), Neuer Termin, Vorlage wählen, Termin aus Vorlage/Serie und Termin bearbeiten sind im Design Dialoge über dem Kalender (bzw. der Terminliste), mobil Bottom-Sheets; der öffentliche Termin ist ein Dialog über dem öffentlichen Feed. Export, Import, Vorlagen und Einstellungen bleiben Seiten.
- Umsetzung: geroutete Modals (Background-Location-Pattern). Die URLs (`…/events/new`, `…/events/new/form`, `…/events/new/template[/:templateId]`, `…/events/:eventId`, `/feed/:feedId/events/:eventId`) bleiben teilbar; ein Direktaufruf zeigt Kalender bzw. Feed (im Monat des Termins) im Hintergrund. Hintergrund inert, Schritte ersetzen den History-Eintrag, Browser-Zurück schließt (bei ungespeicherten Änderungen erst nachfragen). Details: `frontend/AGENTS.md` (Routed modals).
- Baustein: `Modal` / `ModalFrame` / `DialogFrame` in `components/ui/shared/` (auch Basis von `FormDialog`).

## Regeln für alle Agents
- Nur `frontend/` ändern (Ausnahme: dokumentierter Bug im Backend). Kein Commit; der Orchestrator committet nach erfolgreicher Verifikation.
- Tests mitpflegen: Vitest (Komponenten/Logik) und Playwright (`frontend/e2e/`). Veraltete Tests anpassen, nicht löschen, um grün zu werden.
- Checks vor Abgabe: `npm run build -w frontend`, `npm test -w frontend`, `npm run lint -w frontend`.
- Rückmeldung kurz: geänderte Dateien, offene Punkte, Backend-Lücken.
