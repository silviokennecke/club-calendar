# Backend-Lücken (Features, die das Design braucht, das Backend aber nicht bietet)

Fortlaufend ergänzt während des Redesigns.

- Passwort vergessen / zurücksetzen: kein Endpoint (Design: ForgotPassword).
- Terminserien (wiederkehrende Termine): Event hat keine Wiederholungsregel (Design: EventSeries).
- Phase 0: Verein löschen – der Bestätigungsdialog soll den Umfang nennen ("Löscht 14 Termine und 2 Feeds"). Es gibt keinen Endpoint mit Zählern (Termine/Feeds je Verein bzw. Kalender); aktuell wird nur die Anzahl der Kalender genannt.
- Phase 0: Theme-Wahl (Hell/Dunkel/System) wird nur im Browser (localStorage) gespeichert, nicht am Benutzer (bewusst laut Plan; nur relevant, falls geräteübergreifend gewünscht).
