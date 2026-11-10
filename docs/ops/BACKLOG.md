# Backlog: offene Punkte

Offene Backend-Features, Sicherheitsrisiken, Betriebspunkte und Design-Entscheidungen. Endpoints, Schemas und Fehlercodes: [`../api/openapi.yaml`](../api/openapi.yaml). Betrieb: [Admin-Guide](../admin/docs/index.md), Maintainer-Notizen: [`OPERATIONS.md`](OPERATIONS.md). E2E-Umgebung: [`E2E.md`](E2E.md).

## Offene Backend-Features

### Konten

- **Theme** wird nur im Browser gespeichert (localStorage), nicht am Benutzer (bewusst).
- **E-Mail-Wechsel für SSO-only-Konten** ist nicht möglich (409 `no_password`), bis ein Passwort gesetzt ist
  ("Passwort per E-Mail festlegen" im Profil); eine Bestätigung über eine erneute SSO-Anmeldung gibt es nicht.
- **Keine Mail an eine bereits vergebene neue Adresse** (bewusst): weder Bestätigungslink noch Hinweis; der
  Wechsel bleibt unsichtbar wartend (kein Orakel, und sonst könnte jeder beliebigen Kontoinhabern Mails schicken).
  Die bisherige Adresse bekommt den Hinweis trotzdem. Keine Hinweis-Mail bei "Passwort vergessen" (Spam-Vektor).
- **Mehrere Konten desselben Anbieters** (z. B. zwei Google-Konten) lassen sich nicht verknüpfen (`already_linked`).
- **Inaktive Konten ohne Verein** werden nicht automatisch gelöscht. Geplant: Konten ohne Vereinsmitgliedschaft nach X Tagen
  ohne Aktivität löschen, vorher Hinweis per E-Mail. Dafür fehlen Zeitstempel der letzten Aktivität, ein Cron-Befehl wie
  die `app:prune-*`-Befehle und Konfiguration für X und die Vorankündigungsfrist. Nicht umgesetzt.

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

- **Kurze Adressen** (`/k/<verein>/<feed>`, `?key=` im Design) bräuchten Slugs je Verein und Feed (Slugs fehlen im API; Entscheidung nötig).
  Heute: Webansicht `…/feed/{id}?secret=…`, ICS `{API}/api/feed/{id}/ics?secret=…`.
- **Geheimnis** wird für jeden Feed erzeugt und ausgeliefert, auch für öffentliche und nur per Linke (nur bei
  privaten relevant). Beim Wechsel von Privat zu Öffentlich/Nur per Link bleibt es unverändert; beim Wechsel von
  Öffentlich/Nur per Link zurück zu Privat erzeugt `FeedService::update()` immer ein **neues** Geheimnis (das alte
  kann in der offenen Phase in geteilten Links, Logs oder dem Browserverlauf gelandet sein und darf nicht wieder
  Zugriff geben); die Feedliste zeigt danach die neuen Adressen.
- **Archiviert vs. unbekannt:** beide 404 ohne Code; ein Zustand "Kalender archiviert" bräuchte einen eigenen
  Status/Code. Falsches und fehlendes Geheimnis sind nicht unterscheidbar (für Gäste gewollt).
- **Indexierung:** gesteuert je Feed (indexierbar genau bei Status `PUBLIC`; die Option `searchable` entfiel mit `Version20261021120000`). Die SPA-Seiten
  `/feed/*` bekommen ihr noindex nur per `<meta>` (aus `feed.indexable`); der Webserver sendet für sie kein
  `X-Robots-Tag` (bewusst nur Backend). Ein Abschalten der Option entfernt bereits indexierte Seiten erst beim
  nächsten Besuch der Suchmaschine.
- **Ein-Termin-ICS in "Mein Verein"**: Der Download "Zum Kalender hinzufügen" gibt es nur für Termine öffentlicher Feeds
  (`GET /api/feed/{feedId}/events/{eventId}/ics`), nicht für Termine der persönlichen Kalenderansicht. Dafür fehlt eine
  Backend-Route mit demselben Zugriff wie das persönliche Abo.
- **Zielgruppen-Chips in der persönlichen Kalenderansicht** listen alle Zielgruppen des Vereins, nicht nur die, die in den
  angezeigten Terminen vorkommen. Vorgesehen: die Auswahl aus den Terminen ableiten.
- **Rate-Limit persönlicher Abo-Adressen** (`/api/feed/me/…`): sie teilen sich den IP-Zähler mit den übrigen Feed-Routen
  (`FEED_RATE_LIMIT_PER_IP`). Ein eigener Zähler oder das bewusst gemeinsame Limit ist eine Entscheidung, noch offen.

### Import und Export

- **Wiederholungen (RRULE)** werden im Browser nur in der Teilmenge (siehe `docs/api/openapi.yaml`) ausgeschrieben (BYSETPOS, BYHOUR,
  BYWEEKNO, BYYEARDAY, stündlich u. ä.: nur der erste Termin, mit Warnung). Importierte Instanzen sind
  **Einzeltermine** (keine Serie der App, bewusst: beliebige RRULEs passen nicht in das Serienmodell).
- **Duplikate innerhalb einer Datei** werden nicht verglichen (zwei VEVENTs mit gleicher UID ohne RECURRENCE-ID kommen
  beide in die Liste). Instanzen einer Wiederholung haben je eine eigene UID (`UID#YYYYMMDD`).
- **Veraltete Zuordnungen zwischen Vorschau und Import** lassen den Import als Ganzes scheitern (422
  `unknown_reference`, nichts gespeichert, UI: "Es wurde nichts importiert").
- **ICS-Zeilenlänge:** `X-APPLE-STRUCTURED-LOCATION` wird von `eluceo/ical` nicht auf 75 Oktette gefaltet (Parser wie
  sabre/vobject lesen die Datei trotzdem). Serientermine erscheinen in Feeds und Export als einzelne VEVENTs ohne
  RRULE/Serienkennung (bewusst: Abos sehen so auch einzeln geänderte oder gelöschte Termine richtig). **Kein
  `X-CC-SERIES-ID`** (bewusste Entscheidung): eine Serienkennung im ICS würde Serien-Interna im öffentlichen
  Feed preisgeben; ein Wiederimport erkennt Termine über die UID des Exports.

### Listen und Mitglieder

- **Doppelte Namen** von Eigenschaften/Features/Zielgruppen aus früherer Zeit bleiben erhalten; es gibt keinen
  Unique-Index (die Prüfung ist eine Komfortprüfung, gleichzeitige Anlagen können beide durchgehen).
- `PATCH /api/clubs/{id}` kann die Zeitzone ändern; das Design zeigt sie nur im Seitenkopf, daher kein UI-Feld.

### Dokumentation

- Das Frontend leitet seine API-Typen von Hand ab (`frontend/src/lib/types.ts`), nicht aus `docs/api/openapi.yaml`.
- Kein eigener E2E-Seed außer den Fixtures (die Suite bestätigt Nutzer mit `app:user:verify` und holt Reset-Links mit
  `app:user:reset-link`).

## Offene Sicherheitsrisiken

Hier steht die einzige maßgebliche Liste der offenen Sicherheitspunkte. Die Audit-Berichte liegen unter [`../security-audit/`](../security-audit/) (`SECURITY_AUDIT_REPORT.md`, `AUDIT-2026-10-06.md`, Bereichsberichte `01` bis `04`) und enthalten die Details zu den Audit-IDs. Stand: Prüfung gegen den Code am 2026-11-06.

| Schweregrad | Risiko | Details / mögliche Behebung |
| --- | --- | --- |
| niedrig | **API-53 (ehemals L5): öffentliche statische Kartenbilder** | `/api/map/image/location/{id}` und `/event/{id}` sind ohne Anmeldung erreichbar (für anonyme Feed-Seiten) und prüfen nicht, ob Ort/Termin in einem Feed veröffentlicht ist; Ausgabe ist nur ein Kartenbild mit der Position. IP-Limit 360/h; das gemeinsame Mapbox-Bildbudget bleibt von vielen IPs erschöpfbar. Behebung: feed-gebundene/signierte URLs bzw. Mitgliedsprüfung in der App. |
| info | **I3: Backend-Hinweise** | Fixtures-Passwort `password123` (nur Dev/CI); `app:prune-unverified-users` steht als Cron im Admin-Guide (`docs/admin/docs/security.md`), nichts im Repo plant es ein; Refresh-Token ist ein selbst gebauter HS256-Token mit Standard-Base64; `OidcProvider` ohne PKCE zum Identity Provider; lokale `config/jwt/public.pem` mit 0666 (Umask des Entwicklerrechners, öffentlicher Schlüssel); 404-vs-403-Orakel auf Verein-/Kalender-IDs. |
| info | **I4: Frontend-Hinweise** | Routen-Guards nur clientseitig (Backend erzwingt); IDs in API-Pfaden meist ohne `encodeURIComponent` (serverseitige UUIDs); OAuth-Provider-ID unkodiert im `href`. |
| info | **SCAN-12 (Rest): Release-`ci`-Aufruf mit `contents: write`** | `release.yml` muss `contents: write` an `ci.yml` geben, weil dort `autofix` es deklariert (läuft auf Tags nicht). |
| niedrig | **MCP: Familien-Treffer beweist nicht den Betreiber** | Die Bezeichnung (Claude, ChatGPT, Gemini) kommt aus der Redirect-URI-Familie, der selbst angegebene `client_name` gilt nur als Behauptung. Ein eigener ChatGPT-Konnektor (`chatgpt.com/connector/oauth/<id>`) oder ein lokales Programm (Loopback) trifft trotzdem eine Familie; akzeptiert, die Zustimmungsseite warnt dafür gesondert. Ein leeres `MCP_ALLOWED_CLIENTS` erlaubt keinen Client mehr, alle nur mit `*`. |
| niedrig | **Refresh-Token im localStorage** | Der Refresh-Token liegt im Browser-Speicher (`localStorage`), damit die Anmeldung neue Tabs und Browser-Neustarts übersteht. Skripte auf der Seite (XSS) können ihn lesen. Abgemildert durch strikte CSP und Rotation mit Wiederverwendungserkennung. Option: Refresh-Token als HttpOnly-Cookie (Variante B); braucht CSRF-Schutz und eine Umstellung bei getrennten Ursprüngen. |
| niedrig | **MCP: Bundle vor 1.0** | `symfony/mcp-bundle` ist auf `~0.15.0` gepinnt (mcp/sdk 0.9); API und Verhalten können sich bei Updates ändern, Updates nur mit laufender `McpEndpointTest`/Tool-Tests. |

## Offene Betriebspunkte

- **Safari und SSO:** das State-Cookie ist `Secure; HttpOnly; SameSite=None` (Pfad `/api/auth/oauth`); `None` ist nötig, weil Apple per `form_post` zurückspringt (cross-site POST, Lax-Cookies fallen weg). Safari verhält sich dabei nicht zuverlässig, SSO dort prüfen und ggf. Cookie-Strategie anpassen. Kein Codefehler gefunden, die Cookie-Logik wurde mit Playwright WebKit bestätigt (nicht mit echtem Safari); der Lauf in echtem Safari steht aus.

## Akzeptierte Abweichungen

- **AUTH-07: Fehlergrund im Weiterleitungslink der Adressänderung.** `GET /api/auth/verify-new-email` leitet bei einem Fehler auf `/auth/verify-email?status=error&reason=…&flow=email_change` (`invalid`, `expired`, `already_used`, `email_taken`); die Seite `EmailVerifyPage` zeigt je Grund eine passende Meldung. Vom Auftraggeber als gewolltes Verhalten bestätigt. Die Registrierungs-Bestätigung per Link (ursprünglicher Ort des Befunds) gibt es nicht mehr, sie läuft per 6-stelligem Code.
- **HSTS (Betrieb):** Entscheidung des Eigentümers: `Strict-Transport-Security` setzt der TLS-Terminator vor dem Container, nicht der Container (Betreiberaufgabe, siehe `docs/admin/docs/security.md`).
- **Mapbox-Token in Logs (ehem. L10):** Der Eigentümer hat bestätigt, dass das Mapbox-Token bereits so eingeschränkt ist, wie es möglich ist. Die Log-Redaktion ist umgesetzt (`63e3547`).

## Offene Design-Punkte

- **Design-L1: Archivierter Kalender, Knopf-Beschriftung.** Das Design öffnet einen archivierten Kalender in seinem Zeitraum und beschriftet den Knopf "Zurück zu <Monat>"; die App öffnet im aktuellen Monat mit "Heute". Regel für den Startmonat fehlt (letzter Termin? Archivierungsdatum?). Entscheidung nötig.
- **Design-L5: Kurze Feed-Adressen** (`/k/<verein>/<feed>`): benötigt Slugs je Verein und Feed im API; zusammen mit der Lücke "Kurze Adressen" unter "Feeds und öffentlicher Zugriff" entscheiden.
- **Design-L6: Dialogtexte uneinheitlich.** Der Passkey-Dialog hat in den Dialogs keinen Namen, im Profil mit Namen; der Vorlagen-Löschdialog existiert in zwei Fassungen. Klärung im Design nötig.

