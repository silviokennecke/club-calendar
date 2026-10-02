# Redesign: Umsetzungsplan

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
0. Fundament (Opus): Tokens/CSS/Figtree, Tailwind-Mapping, ThemeProvider, Basis-Bausteine (Button, Field, Toggle, Tag, StatusBadge, Banner, EmptyState, ConfirmDialog, CopyField, ChipSelect, EmojiPicker, Stepper, LangSwitch, Logo, Toast, Skeleton), AppShell (Sidebar, Topbar, Tabbar, Kontextwechsel, Menu mobil).
1. Zugang (Sonnet): Login, Registrierung, E-Mail bestätigen, Passwort vergessen (deaktiviert), Fehlerzustände, SSO-Callback.
2. Einrichtung und Wechsel (Sonnet): Vereinsauswahl, Onboarding (Stepper Verein, Kalender), Kontextwechsel.
3. Kalender (Opus): eigene Monats- und Wochenansicht, Filter, Suche, archivierter Kalender, Zustände, mobil.
4. Termine (Opus): Liste, Neu-Auswahl, Formular, Aus Vorlage, Serie (deaktiviert), Export, Dialoge.
5. Import und Vorlagen (Sonnet): Import, Review, Fertig, Vorlagenliste, Vorlage bearbeiten.
6. Einstellungen (Sonnet): Allgemein, Eigenschaften, Features, Zielgruppen, Orte (Karte), Feiertage.
7. Veröffentlichen, Verein, Profil (Sonnet): Feeds, FeedEdit, Verein verwalten, Profil inkl. Theme-Schalter.
8. Öffentlicher Zugriff (Sonnet): Public-Feed, Termin-Detail, Zustände.
9. Abschluss (Opus): FullCalendar und ungenutzte shadcn-Teile entfernen, E2E komplett, CLAUDE.md/AGENTS.md aktualisieren, Backend-Lücken finalisieren.

## Regeln für alle Agents
- Nur `frontend/` ändern (Ausnahme: dokumentierter Bug im Backend). Kein Commit; der Orchestrator committet nach erfolgreicher Verifikation.
- Tests mitpflegen: Vitest (Komponenten/Logik) und Playwright (`frontend/e2e/`). Veraltete Tests anpassen, nicht löschen, um grün zu werden.
- Checks vor Abgabe: `npm run build -w frontend`, `npm test -w frontend`, `npm run lint -w frontend`.
- Rückmeldung kurz: geänderte Dateien, offene Punkte, Backend-Lücken.
