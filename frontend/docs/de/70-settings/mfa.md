---
title: Zwei-Faktor-Anmeldung (MFA)
order: 25
description: Einen zweiten Schritt bei der Anmeldung einrichten, mit Authenticator-App oder Passkey.
---

# Zwei-Faktor-Anmeldung (MFA)

Mit Zwei-Faktor-Anmeldung (MFA) fragt dich die Anmeldung mit Passwort zusätzlich nach einem zweiten Schritt: einem Code aus einer Authenticator-App oder einem Passkey.

Den Abschnitt findest du in deinem [Profil](help:settings/profile) unter **Zwei-Faktor-Authentifizierung (MFA)**.

## Authenticator-App einrichten

1. Klicke im Abschnitt auf **MFA-Methode hinzufügen**.
2. Wähle **Authenticator-App** und klicke auf **Weiter**.
3. Scanne den QR-Code mit deiner App. Kannst du ihn nicht scannen, gib den **Einrichtungsschlüssel** in der App ein.
4. Gib den 6-stelligen Code ein, den deine App anzeigt, unter **Code aus der App**.
5. Bewahre die **Backup-Codes** sicher auf (siehe unten). Setze den Haken bei **Ich habe die Backup-Codes aufbewahrt** und klicke auf **Weiter**.
6. Bestätige, dass du es bist: Gib dein Passwort ein und klicke auf **Aktivieren**. Hat dein Konto kein Passwort, klicke auf **Code senden** und gib den Code aus der E-Mail ein.

Du kannst nur eine Authenticator-App einrichten. Statt einer App kannst du im selben Schritt auch einen **Passkey** als zweiten Schritt wählen.

## MFA mit einem vorhandenen Passkey einschalten

Hast du schon einen Passkey, kannst du MFA direkt damit einschalten. Der Knopf **MFA einschalten** erscheint, wenn MFA ausgeschaltet ist und du mindestens einen Passkey hast.

1. Klicke auf **MFA einschalten**.
2. Bewahre die Backup-Codes sicher auf, setze den Haken bei **Ich habe die Backup-Codes aufbewahrt** und klicke auf **Weiter**.
3. Bestätige, dass du es bist, und klicke auf **MFA einschalten**.

## Bei der Anmeldung

Nach dem Passwort fragt dich die Anmeldung nach dem zweiten Schritt. Du hast drei Möglichkeiten:

- **Code aus der Authenticator-App verwenden**: Gib den aktuellen 6-stelligen Code ein.
- **Backup-Code verwenden**: Gib einen deiner Backup-Codes ein.
- **Passkey verwenden**: Bestätige am Gerät mit dem Passkey.

Bei der Anmeldung mit Google, Microsoft oder einem Passkey fragt die Anmeldung nicht nach dem zweiten Schritt.

## Backup-Codes

Backup-Codes sind Ersatzcodes, falls du deine Authenticator-App nicht benutzen kannst. Du bekommst sie, wenn du MFA einrichtest. Jeder Code funktioniert nur einmal. Bewahre sie an einem sicheren Ort auf.

Neue Codes bekommst du im Abschnitt über **Neu erzeugen** bei **Backup-Codes**. Bestätige, klicke auf **Codes erzeugen** und speichere die neuen Codes. Die alten funktionieren danach nicht mehr.

## Handy verloren

:::warning
Wenn du dich mit einem Backup-Code anmeldest, wird MFA ausgeschaltet. Die Authenticator-App und die Backup-Codes werden gelöscht, und alle anderen Geräte werden abgemeldet.
:::

Melde dich mit deinem Passwort an, wähle **Backup-Code verwenden** und gib einen Code ein. Danach richtest du MFA im Profil mit einer neuen Authenticator-App wieder ein.

## MFA ausschalten

1. Klicke im Abschnitt auf **MFA ausschalten**.
2. Bestätige, dass du es bist: Gib dein Passwort ein (ohne Passwort: den Code aus der E-Mail) und klicke auf **MFA ausschalten**.

Die Authenticator-App und die Backup-Codes werden gelöscht. Deine Passkeys bleiben erhalten. Alle anderen Geräte werden abgemeldet.

:::note
Solange MFA eingeschaltet ist und keine Authenticator-App eingerichtet ist, kannst du deinen letzten Passkey nicht entfernen.
:::

## Siehe auch

- [Passkeys](help:settings/passkeys)
- [Passwort](help:settings/password)
- [Anmeldungen und Abmelden](help:settings/sessions)
