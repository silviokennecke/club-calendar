# Backend-Lücken (Features, die das Design braucht, das Backend aber nicht bietet)

Fortlaufend ergänzt während des Redesigns.

- Passwort vergessen / zurücksetzen: kein Endpoint (Design: ForgotPassword).
- Terminserien (wiederkehrende Termine): Event hat keine Wiederholungsregel (Design: EventSeries).
- Phase 0: Verein löschen – der Bestätigungsdialog soll den Umfang nennen ("Löscht 14 Termine und 2 Feeds"). Es gibt keinen Endpoint mit Zählern (Termine/Feeds je Verein bzw. Kalender); aktuell wird nur die Anzahl der Kalender genannt.
- Phase 0: Theme-Wahl (Hell/Dunkel/System) wird nur im Browser (localStorage) gespeichert, nicht am Benutzer (bewusst laut Plan; nur relevant, falls geräteübergreifend gewünscht).
- Phase 1: Registrierung/Login-Fehler kommen als RFC-7807-JSON (`detail`), nur Login-403 als `{error: "email_not_verified"}`. Das Frontend erkennt "E-Mail bereits vergeben" am Text `Email already in use` (apiPost liest jetzt `error ?? detail`). Ein stabiler Fehlercode (z. B. `code: "email_taken"`) im Backend wäre robuster.
- Phase 1: `/api/auth/oauth/*`-Fehler werden als Klartext-Message in `?error=` weitergereicht; das Frontend zeigt nur eine generische SSO-Meldung. Ein Fehlercode wäre nötig, um Ursachen (abgelehnt, E-Mail unbestätigt beim Anbieter, ...) zu unterscheiden.
- Phase 1: Passwort-vergessen-Seite (`/forgot-password`) ist gebaut, Absenden deaktiviert ("Bald verfügbar"); der Zustand "Prüfe dein Postfach" aus ForgotPassword.dc.html fehlt bis ein Reset-Endpoint existiert.
