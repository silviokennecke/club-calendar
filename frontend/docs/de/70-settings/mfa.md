---
title: Multi-Faktor-Authentifizierung (MFA)
order: 25
description: MFA einrichten, mit Authenticator-App oder Passkey.
---

# Multi-Faktor-Authentifizierung (MFA)

Mit Multi-Faktor-Authentifizierung (MFA) fragt dich die Anmeldung mit Passwort zusätzlich nach einem weiteren Faktor: einem Code aus einer Authenticator-App oder einem Passkey.

Den Abschnitt findest du in deinem [Profil](help:settings/profile) im Reiter **Sicherheit** unter **Multi-Faktor-Authentifizierung (MFA)**.

![Profil, Abschnitt MFA mit Authenticator-App, Passkey und Backup-Codes](shot:profile-mfa)

## Authenticator-App einrichten

1. Klicke im Abschnitt auf **MFA-Methode hinzufügen**.
2. Wähle **Authenticator-App** und klicke auf **Weiter**.

![Auswahl der MFA-Methode: Authenticator-App oder Passkey](shot:mfa-add-method)

3. Scanne den QR-Code mit deiner App. Kannst du ihn nicht scannen, gib den **Einrichtungsschlüssel** in der App ein.
   ![Einrichtung der Authenticator-App mit QR-Code und Einrichtungsschlüssel](shot:mfa-totp-setup)

4. Gib den 6-stelligen Code ein, den deine App anzeigt, unter **Code aus der App**.
   ![Backup-Codes zum Aufbewahren](shot:mfa-backup-codes)

5. Bewahre die **Backup-Codes** sicher auf (siehe unten). Setze den Haken bei **Ich habe die Backup-Codes aufbewahrt** und klicke auf **Weiter**.
6. Klicke auf **Aktivieren**.

Die App bittet dich einmal zu bestätigen, dass du es bist, siehe [Bestätigen, dass du es bist](help:settings/confirmation).

Du kannst nur eine Authenticator-App einrichten. Statt einer App kannst du im selben Schritt auch einen **Passkey** für MFA wählen.

## MFA mit einem vorhandenen Passkey einschalten

Hast du schon einen Passkey, kannst du MFA direkt damit einschalten. Der Knopf **MFA einschalten** erscheint, wenn MFA ausgeschaltet ist und du mindestens einen Passkey hast.

1. Klicke auf **MFA einschalten**.
2. Bewahre die Backup-Codes sicher auf, setze den Haken bei **Ich habe die Backup-Codes aufbewahrt** und klicke auf **Weiter**.
3. Klicke auf **MFA einschalten**. Wirst du gefragt, bestätige, dass du es bist, siehe [Bestätigen, dass du es bist](help:settings/confirmation).

## Bei der Anmeldung

Nach dem Passwort fragt dich die Anmeldung nach dem weiteren Faktor.

![Anmeldung fragt nach dem Code aus der Authenticator-App](shot:sign-in-mfa)

Du hast drei Möglichkeiten:

- **Code aus der Authenticator-App verwenden**: Gib den aktuellen 6-stelligen Code ein.
- **Backup-Code verwenden**: Gib einen deiner Backup-Codes ein.
- **Passkey verwenden**: Bestätige am Gerät mit dem Passkey.

Bei der Anmeldung mit Google, Apple, Microsoft oder einem Passkey fragt die Anmeldung nicht nach MFA. Ist MFA für dein Konto eingeschaltet, kann sich Google oder Apple mit einer Adresse, die noch nicht mit deinem Konto verknüpft ist, nicht anmelden: Melde dich mit Passwort und MFA an und verknüpfe den Anbieter dann in deinem Profil (siehe [Verknüpfte Anmeldungen](help:settings/linked-accounts)).

## Backup-Codes

Backup-Codes sind Ersatzcodes, falls du deine Authenticator-App nicht benutzen kannst. Du bekommst sie, wenn du MFA einrichtest. Jeder Code funktioniert nur einmal. Bewahre sie an einem sicheren Ort auf.

Neue Codes bekommst du im Abschnitt über **Neu erzeugen** bei **Backup-Codes**. Bestätige bei Bedarf, dass du es bist (siehe [Bestätigen, dass du es bist](help:settings/confirmation)), klicke auf **Codes erzeugen** und speichere die neuen Codes. Die alten funktionieren danach nicht mehr.

Das Profil warnt dich, wenn nur noch 2 oder weniger Backup-Codes übrig sind. Meldest du dich mit einem Backup-Code an, schicken wir dir eine E-Mail mit der Zahl der übrigen Codes.

## Handy verloren

:::warning
Hast du Authenticator-App, Backup-Codes und Passkey verloren, kann nur der Betreiber dieser Anwendung MFA für dich zurücksetzen.
:::

Melde dich mit deinem Passwort an, wähle **Backup-Code verwenden** und gib einen Code ein. Der Code funktioniert nur einmal. MFA bleibt eingeschaltet.

Gleich nach der Anmeldung zeigt dir die App, wie viele Codes übrig sind. Dort kannst du deine anderen Geräte abmelden und neue Codes erzeugen.

Hast du die Authenticator-App endgültig verloren, schalte MFA im Profil aus (siehe unten) und richte es mit einer neuen App wieder ein.

## MFA ausschalten

1. Klicke im Abschnitt auf **MFA ausschalten**.
2. Wirst du gefragt, bestätige, dass du es bist (siehe [Bestätigen, dass du es bist](help:settings/confirmation)), und klicke auf **MFA ausschalten**.

Die Authenticator-App und die Backup-Codes werden gelöscht. Deine Passkeys bleiben erhalten. Alle anderen Geräte werden abgemeldet.

:::note
Solange MFA eingeschaltet ist und keine Authenticator-App eingerichtet ist, kannst du deinen letzten Passkey nicht entfernen.
:::

## Siehe auch

- [Passkeys](help:settings/passkeys)
- [Passwort](help:settings/password)
- [Anmeldungen und Abmelden](help:settings/sessions)
