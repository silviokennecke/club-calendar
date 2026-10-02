# Backend-Lücken (Features, die das Design braucht, das Backend aber nicht bietet)

Fortlaufend ergänzt während des Redesigns.

- Passwort vergessen / zurücksetzen: kein Endpoint (Design: ForgotPassword).
- Terminserien (wiederkehrende Termine): Event hat keine Wiederholungsregel (Design: EventSeries).
- Phase 0: Verein löschen – der Bestätigungsdialog soll den Umfang nennen ("Löscht 14 Termine und 2 Feeds"). Es gibt keinen Endpoint mit Zählern (Termine/Feeds je Verein bzw. Kalender); aktuell wird nur die Anzahl der Kalender genannt.
- Phase 0: Theme-Wahl (Hell/Dunkel/System) wird nur im Browser (localStorage) gespeichert, nicht am Benutzer (bewusst laut Plan; nur relevant, falls geräteübergreifend gewünscht).
- Phase 1: Registrierung/Login-Fehler kommen als RFC-7807-JSON (`detail`), nur Login-403 als `{error: "email_not_verified"}`. Das Frontend erkennt "E-Mail bereits vergeben" am Text `Email already in use` (apiPost liest jetzt `error ?? detail`). Ein stabiler Fehlercode (z. B. `code: "email_taken"`) im Backend wäre robuster.
- Phase 1: `/api/auth/oauth/*`-Fehler werden als Klartext-Message in `?error=` weitergereicht; das Frontend zeigt nur eine generische SSO-Meldung. Ein Fehlercode wäre nötig, um Ursachen (abgelehnt, E-Mail unbestätigt beim Anbieter, ...) zu unterscheiden.
- Phase 1: Passwort-vergessen-Seite (`/forgot-password`) ist gebaut, Absenden deaktiviert ("Bald verfügbar"); der Zustand "Prüfe dein Postfach" aus ForgotPassword.dc.html fehlt bis ein Reset-Endpoint existiert.
- Phase 2: `GET /api/clubs` liefert keine Zähler. Die Vereinsauswahl ("3 Kalender · 3 Mitglieder") holt dafür je Verein `/calendars?includeArchived=true` und `/members` (N+1 Requests). Ein `calendarCount`/`memberCount` in der Club-Liste wäre schlanker.
- Phase 2: Es gibt keinen verifizierten Weg, in E2E-Tests einen Nutzer ohne Mailversand zu bestätigen (MAILER_DSN=null). `e2e/onboarding.spec.ts` setzt `is_email_verified` per PHP-PDO direkt in der E2E-Datenbank. Ein Test-/Dev-Endpoint oder eine Console-Command (`app:user:verify <email>`) wäre sauberer.
- Phase 2: Beim Vereinswechsel in der Shell wird der erste (nicht archivierte) Kalender des Zielvereins geöffnet; "zuletzt genutzter Kalender je Verein" wird nur für den zuletzt genutzten Verein gespeichert (`lastClubId`/`lastCalendarId` am Benutzer).
- Phase 3: `GET /api/calendars/{id}/events?from&to` filtert nur nach dem Startdatum (`e.date` zwischen from und to). Mehrtägige Termine, die vor dem sichtbaren Zeitraum beginnen, fehlen dadurch. Das Frontend lädt deshalb 31 Tage früher und filtert lokal nach Überlappung (`MULTI_DAY_LOOKBACK_DAYS` in `src/lib/calendar/view.ts`); längere Termine können weiterhin fehlen. Nötig: Überlappungsfilter (`date <= to AND COALESCE(dateEnd, date) >= from`).
- Phase 3: Kein Zähler/Existenz-Endpoint für Termine eines Kalenders. Für den Leerzustand "Noch keine Termine in diesem Kalender" lädt das Frontend (nur wenn der sichtbare Zeitraum leer ist) einmal die komplette Terminliste ohne Zeitraum. Besser: `eventCount` am Kalender oder `?limit=1`.
- Phase 3: Zielgruppen haben keine Farbe/Tonalität. Die Tag-Farben (Jugend/Erwachsene/Senioren im Design) vergibt das Frontend reihum nach Position in der Zielgruppenliste.
- Phase 3: Der öffentliche Feed (`/api/feed/{id}/events`) liefert keine Feiertage; die öffentliche Monatsansicht zeigt daher keine.
