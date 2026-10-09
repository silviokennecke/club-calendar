# Backend-Lücken: Umsetzungsplan

Stand: 2026-10-09. Grundlage: `BACKEND-GAPS.md` (Abschnitt "Offene Backend-Features"). Die Regel "Backend nur bei
Fehlern ändern" gilt für diese Runde NICHT mehr: der Auftraggeber hat die Umsetzung der Lücken beauftragt.

## Ausgenommen (bereits in den Audits dokumentiert, nicht Teil dieser Runde)

`SECURITY_AUDIT_REPORT.md` und `docs/security/AUDIT-2026-10-06.md` (untracked, nicht anfassen): Rollen/Einladungen/
letzter Admin (H1, M8, L1), Pre-Hijacking (H2), Mapbox-Proxy (H3), Microsoft-SSO unverifiziert (H4), Rate-Limiting für
Login/Register/Token (M1), Host-Header (M2), ICS-Injection (M3), CSP/Header (M4), Tokens im Redirect (M5),
Refresh-Rotation (M6), Quoten/unbegrenzte Listen (M7), Enumeration, Karten-Bilder, CORS-Regex, Secrets/Deploy.
Neue Endpoints müssen trotzdem sicher gebaut werden (kein Orakel, Einmal-Token, Ablauf, Limiter nach dem Muster
`email_verification_resend`), das ist Teil der Umsetzung und kein Audit-Punkt.

## Pakete (je Paket: Implementierungs-Agent, danach unabhängige Verifikation, dann Commit)

1. **Zähler, Einzel-Endpoints, öffentlicher Kopf** (Opus): `calendarCount`/`memberCount` je Verein; `eventCount`/
   `templateCount`/`feedCount` je Kalender; Nutzungszähler je Eigenschaft/Feature/Zielgruppe/Ort/Vorlage;
   `GET …/feeds/{id}`; öffentlicher Feed: `clubName`, `calendarName`, wirksame `timezone`, `visibility`, `from`/`to`,
   Einzeltermin-Endpoint, Feiertage; Namen der Duplikate-Kopie lokalisierbar; Duplikat-Namen von Eigenschaften/
   Features/Zielgruppen im Backend prüfen; Vorlagen-Zeiten optional (nullable). Frontend: N+1-Requests, Zähler im
   UI, Kopf des öffentlichen Feeds, Lösch-Dialoge mit Zählern, Zeitzone, optionale Vorlagen-Zeiten.
2. **Import, Export, Bulk, Fehlercodes** (Opus): `POST …/events/import/preview` (Duplikate per `externalUid`/Name+
   Datum, Fehler je Termin), atomarer Import inkl. neuer Orte mit Zählern, `externalUid`; Export-Endpoint
   `GET …/events.ics`; Bulk-Endpoints (veröffentlichen/Entwurf/löschen); stabile Fehlercodes (`code` im RFC-7807-
   Body) für Registrierung/Login/OAuth/Import; veraltete TZIDs tolerieren. Frontend entsprechend umstellen.
3. **Auth und Konten** (Opus): Passwort vergessen/zurücksetzen (inkl. Seite zum Setzen des neuen Passworts und
   Zustand "Prüfe dein Postfach"); Profil: Name, Passwort, E-Mail ändern (mit Bestätigung); SSO verknüpfen/trennen mit
   Schutz "mindestens eine Anmeldemethode bleibt"; Passkey "zuletzt benutzt"; letzter Kalender je Mitgliedschaft;
   Console-Command `app:user:verify`; feinere OAuth-Fehlercodes. Frontend: ForgotPassword aktivieren, ResetPassword,
   Profil-Bearbeitung, Verknüpfen/Trennen.
4. **Terminserien** (Opus): Serien-Modell (Regel + `series_id` an Terminen), Anlegen aus Vorlage/Regel (Feiertage
   auslassen), Bearbeiten/Löschen mit Geltungsbereich "nur dieser Termin / alle Termine der Serie" (laut Design:
   EventSeries, EventForm, Dialogs), Kennzeichnung "Wiederkehrend". Frontend: "Serie anlegen" aktivieren, Serien-
   Dialoge, Tag.

## Regeln für alle Pakete

- Migrationen (UUID-IDs, `Uuid::v7()`), PHPUnit-Tests je Feature in `backend/tests/Controller` (rot ohne Umsetzung),
  Frontend-Anpassung mit Vitest- und Playwright-Tests (isolierte E2E-Umgebung, `E2E.md`).
- Frontend- und Backend-Änderungen eines Pakets gehören in denselben Arbeitsgang (kein totes API).
- i18n de/en identisch, Barrierefreiheit wie bisher, keine Emojis als UI-Icons.
- `CLAUDE.md`, `AGENTS.md`, `frontend/AGENTS.md`, `BACKEND-GAPS.md` (erledigte Punkte nach "Behobene/Umgesetzt"
  verschieben), `COVERAGE.md` (Abweichungen "Bald verfügbar" aufheben) aktuell halten.
