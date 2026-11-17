# Ressourcen- und Dienstplanung

Planungsdokument (maintainer-only). Feature 1 (Ressourcen) wird umgesetzt, Feature 2 (Dienste) folgt später.

## Feature 1: Ressourcen

### Entscheidungen

- "Administrative Nutzer" = Club-Rollen viewer, editor, admin.
- Eigene Entität `Resource`, Typ `location`: geprüft wird auf `event.location_id`. Weitere Typen später.
- `allowDoubleBooking=true` erzeugt dennoch Warnungen (nie Fehler). Mit `false` führt Überschneidung mit einem veröffentlichten Termin zu einem Fehler.
- Puffer in Minuten in der DB (`buffer_minutes`, 0..1440), die Oberfläche nimmt volle Stunden (0..24).
- Die Konfliktprüfung läuft immer, auch ohne Ressourcen-Zugriff, und liefert immer mindestens Kalendername und Zeitraum.
- MCP-Clients: nur Lesezugriff auf Ressourcen (Tool `list_resources`, scope `mcp:read`), keine Schreib-Tools.

### Entitäten

| Entität | Felder |
|---|---|
| `Resource` | id (UUID v7), club, `type` (`location`), name, `location` (FK, unique, CASCADE), `visibility` (`staff`\|`members`), `allow_double_booking` (bool), `buffer_minutes`, Audit-Felder |
| `CalendarMember` | id (UUID v7), calendar (CASCADE), user (CASCADE), `created_by` (SET NULL), `created_at`, Audit-Felder; unique (calendar, user) |

Neuer Index `event(location_id, date)`. Kein Cache für den Ressourcen-Kalender (reine Abfrage).

### Konfliktregeln

1. Zeitraum = Beginn bis Ende (mehrtägig über `dateEnd`). Ganztägig oder ohne Ende = ganzer Tag.
2. Bei nicht ganztägigen Terminen gilt auf beiden Seiten der Puffer der Ressource.
3. Vergleich in absoluten Zeitpunkten (UTC), jeweils mit der Zeitzone des Termins bzw. Kalenders.
4. Einstufung:
   - Überschneidung mit einem Entwurf: Warnung.
   - Überschneidung mit einem veröffentlichten Termin: Fehler `resource_conflict` (422), nur wenn `allow_double_booking=false`, sonst Warnung. Der neue Termin darf als Entwurf gespeichert werden.
   - Kollision nur im Pufferbereich: immer nur Warnung.
5. Jeder Konflikt nennt mindestens Kalendername und Zeitraum, außerdem Entwurf ja/nein und Art (Überschneidung oder Puffer). Staff zusätzlich Titel und Link.
6. Veröffentlichen (Einzeltermin, Bulk, Serie, Import, Termin aus Vorlage mit `isDraft=false`) prüft serverseitig im selben Request mengenbasiert (Self-Join), unter `FOR UPDATE` auf der Resource-Zeile.
7. Prüfpunkte: `EventService::applyInput`/`buildEvent`, `EventService::bulk` (publish), `EventSeriesService`, Import.

### Berechtigungen

- Ressourcen verwalten: Club-Admin. Lesen: viewer/editor/admin; bei `visibility=members` auch alle Mitglieder, aber nur als "belegt" mit Zeitraum und Kalendername.
- `CalendarMember`: Mitglieder mit Club-Rolle `member` dürfen im zugewiesenen Kalender Termine, Serien, Vorlagen, Besonderheiten (properties) und Zusatzangebote (features) lesen und bearbeiten. Feiertage und allgemeine Kalendereinstellungen nur lesen, die Berechtigungsverwaltung ist ihnen verschlossen.
- Orte und Gruppen (club-weit) nur lesend, damit das Formular funktioniert.
- Verwaltung im Kalender als eigener Tab "Berechtigungen" (Club-Admin). Autocomplete bietet alle Vereinsmitglieder, unabhängig von der Rolle.
- Austritt/Entfernung aus dem Club löscht die `CalendarMember`-Zeilen. Benutzerlöschung per CASCADE.
- DSGVO-Export, Drift-Test, OpenAPI und Hilfeseite werden mitgezogen (Arbeitsregel 12). `MemberRoleTest`-Allow-List wird angepasst.

### Oberfläche

- Eigener Menüpunkt "Ressourcen" im Bereich "Verein".
- Ressourcen-Kalender: nur Kalenderdarstellung (Monat/Woche), keine Filter, keine Suche, keine Liste.
- Terminformular: Live-Prüfung mit Warnungen/Fehlern unter dem Ortsfeld.

### Umsetzungsschritte

1. Resource: Entität, Migration, Service, CRUD, Tests, OpenAPI.
2. Resource: Frontend-Seite (Menüpunkt "Verein"), i18n, Hilfeseite.
3. Konfliktdienst, Endpunkt `POST /api/calendars/:id/events/conflicts`, Prüfung beim Veröffentlichen, Tests.
4. Konfliktanzeige im Terminformular.
5. Ressourcen-Kalender: Endpunkt und Ansicht, Sichtbarkeit.
6. `CalendarMember`: Entität, Voter, Endpunkte, Tab, Export, Tests.
7. MCP: `list_resources` (read).
8. Doku: Admin-Guide, Hilfe, CHANGELOG, OpenAPI, CLAUDE.md/AGENTS.md.

## Feature 2: Dienstplanung (später)

Keine Verbindung zu `TargetGroup`: eigene Dienstgruppen.

| Entität | Zweck |
|---|---|
| `Person` | Roster-Eintrag eines Vereinsmitglieds (club, Name, optionale E-Mail, `user` nullable SET NULL, Status aktiv/ausgetreten). Der Dienstplan hängt an der Person, unabhängig von Konto, Löschung und Austritt |
| `DutyGroup` | Dienstgruppe des Clubs |
| `PersonDutyGroup` | Person gehört zu Gruppe |
| `EventDutyRequirement` | (event, group, count); Zeilen werden bei Serien per Bulk-Insert angelegt, Vorlagen/Serien können sie vorgeben |
| `Duty` | event, group, person, slot, `state` (draft\|published), `source` (auto\|manual), `published_at` |

Ablauf: Anforderung am Termin (auch Entwurf); Zuteilung auf eigener Seite je Gruppe (Badge mit Zahl offener Dienste, indizierte Zählung); automatisch (faire Verteilung) oder manuell; immer zuerst Entwurf, dann veröffentlichen. Sichtbar für Staff und betroffene Personen (Mitglied einer zugewiesenen Gruppe). Eigene Dienste im ICS-Feed mit Präfix und Details in der Beschreibung (eigener Feed-Schlüssel je Person, auch ohne Konto). Tausch später.

Konto-Zuordnung (offen): Roster-Import mit E-Mail und Bulk-Einladung mit `personId` (Annahme verknüpft automatisch); Auto-Match über bestätigte E-Mail mit Bestätigung durch den Benutzer. Offen: DSGVO für Personen ohne Konto (Aufbewahrung, Anonymisierung).

## Status (Feature 1 abgeschlossen)

| Schritt | Commit |
|---|---|
| 1 Resource: Entität, Migration, Service, CRUD, OpenAPI | `29591ca1` |
| 2 Frontend-Seite, i18n, Hilfeseite | `98772386` (Screenshots `876767fc`) |
| 3 Konfliktdienst, Endpunkt, Prüfung beim Veröffentlichen | `20fd95e7` |
| 4 Konfliktanzeige im Terminformular | `3d928bc8` |
| 5 Ressourcen-Kalender (API, Ansicht) | `1ea1edac`, `2879b096` |
| 6 `CalendarMember` (Backend, UI) | `3c15c613`, `6c3153df` |
| 7 MCP `list_resources`, `list_resource_events` | `d3a3e917` |
| 8 Dokumentation (CHANGELOG, CLAUDE.md, AGENTS.md, Admin) | dieser Commit |

### Entscheidungen während der Umsetzung

- Puffer: einseitig strikt, also gilt der Puffer der Ressource für den Abstand zu jedem anderen Termin; Kollision nur im Pufferbereich ist immer eine Warnung.
- Bearbeiten und Bulk prüfen nur, wenn sich Zeitplan, Ort oder Status des Termins ändern.
- Import mit neuen Orten ist für Kalender-Mitglieder (`CalendarMember`) verboten.
- Der Ressourcen-Kalender schließt archivierte Kalender ein.
- Die Ressourcenliste und der Ressourcen-Kalender sind für Mitglieder per API offen (nur "belegt"), haben aber keinen UI-Eintrag.
- Admin-Guide: keine neuen Umgebungsvariablen; nur die Telemetrie-Gauges (bereits dokumentiert).

### Offene Punkte

- Navigationseintrag "Ressourcen" und Zugang der Mitglieder zur Ressourcen-UI (Entscheidung des Nutzers).
- Keine Screenshots der Konfliktanzeige im Terminformular.
- Das Rückgängig nach Bulk zeigt keine Konfliktliste.
- Der Import-Dialog bietet Kalender-Mitgliedern die Option "neuer Ort" an; abgesichert nur serverseitig (Review).
