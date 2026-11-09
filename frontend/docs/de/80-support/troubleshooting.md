---
title: Probleme lösen
order: 30
description: Häufige Meldungen und Fehlersituationen mit Ursache und Lösung.
---

# Probleme lösen

Zu jeder Situation findest du das **Symptom** (was du siehst), die **Ursache** und die **Lösung**.

## Anmeldung klappt nicht

**Symptom:** Du kommst nicht rein, oder es erscheint „Zu viele Versuche“ bzw. „Zu viele Versuche. Bitte versuche es in etwa … Min. erneut.“

**Ursache:** E-Mail oder Passwort stimmen nicht, oder es gab zu viele Versuche in kurzer Zeit. Dann sperrt die App die Anmeldung zum Schutz kurz.

**Lösung:** Warte die angezeigte Zeit ab. Prüfe die Schreibweise der Adresse. Hast du das Passwort vergessen, setze es über die Anmeldeseite zurück ([Passwort](help:settings/password)). Alternativ meldest du dich mit [Passkey](help:settings/passkeys) oder [verknüpftem Konto](help:settings/linked-accounts) an.

## Passwort zurücksetzen erforderlich oder Browser nicht unterstützt

**Symptom:** Die Anmeldeseite zeigt **Passwort zurücksetzen erforderlich**, oder die Meldung „Dein Browser oder Gerät unterstützt die sichere Anmeldung nicht“ bzw. „Die sichere Anmeldung ist gerade nicht verfügbar“.

**Ursache:** Dein Konto wurde nach der Umstellung der Passwortprüfung bis zum Stichtag nicht mehr angemeldet und hat noch das alte Passwortverfahren. Oder dein Browser unterstützt WebAssembly bzw. genug Arbeitsspeicher nicht.

**Lösung:** Setze das Passwort über die Anmeldeseite zurück ([Passwort](help:settings/password)). Nutze einen aktuellen Browser. Ist die sichere Anmeldung nur kurz nicht verfügbar, versuche es später noch einmal.

## Anmeldung über Google, Microsoft oder Apple klappt nicht

**Symptom:** Meldungen wie „Die Anmeldung ist abgelaufen …“, „Zu dieser E-Mail-Adresse gibt es schon ein Konto“ oder „Es wurde kein Konto erstellt. Die Registrierung ist nur mit einer Einladung möglich.“

**Ursache:** Die Anmeldung wurde in einem anderen Browserfenster begonnen oder dauerte zu lange; die Adresse gehört schon zu einem Konto; oder dein Verein erlaubt neue Konten nur mit Einladung.

**Lösung:** Starte die Anmeldung im selben Fenster noch einmal. Melde dich so an, wie du es bisher getan hast. Bitte bei „nur mit Einladung“ die Admins deines Vereins, dich an genau diese Adresse einzuladen ([Einladungen](help:team/invitations)).

## E-Mail nicht bestätigt, Code abgelaufen

**Symptom:** „Der Code ist falsch, abgelaufen oder aufgebraucht.“ oder du landest nach der Anmeldung auf der Seite „E-Mail-Adresse bestätigen“ und kommst nicht weiter.

**Ursache:** Der 6-stellige Code ist nur 15 Minuten gültig, nur einmal verwendbar und nach mehreren falschen Eingaben gesperrt.

**Lösung:** Klicke auf der Bestätigungsseite auf **Erneut senden**. Schau auch im Spam-Ordner nach. Fordere Codes nicht zu schnell hintereinander an: Meldet die App „Du kannst um … Uhr einen neuen Code anfordern“, warte bis dahin. Siehe [Konto erstellen](help:getting-started/sign-up).

## Einladung ungültig oder abgelaufen

**Symptom:** „Die Einladung ist ungültig, abgelaufen oder für ein anderes Konto bestimmt.“ oder „Die Einladung ist abgelaufen.“

**Ursache:** Einladungen gelten 7 Tage und nur für die eingeladene, bestätigte E-Mail-Adresse. Du bist eventuell mit einer anderen Adresse angemeldet, oder die Einladung wurde schon beantwortet oder widerrufen.

**Lösung:** Melde dich mit der eingeladenen Adresse an und bestätige sie. Ist die Einladung abgelaufen, bitte einen Admin, sie erneut zu senden ([Einladungen](help:team/invitations)). Meldet die App, der Verein habe die höchste Mitgliederzahl erreicht, kann der Admin zuerst Mitglieder entfernen.

## Zustimmung erforderlich

**Symptom:** Statt des Kalenders erscheint die Seite „Zustimmung erforderlich“.

**Ursache:** Datenschutzerklärung oder Nutzungsbedingungen wurden geändert, und du musst die aktuelle Fassung akzeptieren.

**Lösung:** Lies die Dokumente, hake sie an und klicke auf **Akzeptieren und fortfahren**. Siehe [Zustimmung](help:settings/consent). Willst du nicht zustimmen, kannst du dich abmelden oder dein Konto löschen.

## Du wurdest abgemeldet

**Symptom:** Plötzlich erscheint wieder die Anmeldeseite.

**Ursache:** Die Sitzung ist abgelaufen (spätestens nach 30 Tagen), oder du hast dich auf allen Geräten abgemeldet oder Passwort bzw. E-Mail-Adresse geändert. Dann werden alle Geräte aus Sicherheitsgründen abgemeldet.

**Lösung:** Melde dich einfach neu an. Mehr dazu unter [Sitzungen](help:settings/sessions). Auch verbundene KI-Apps verlieren dabei den Zugriff und müssen neu verbunden werden ([Zugriff verwalten](help:ai-assistants/manage-access)).

## Limit erreicht

**Symptom:** „Limit erreicht: Dieser Verein oder Kalender kann nicht mehr davon aufnehmen.“

**Ursache:** Du hast eine Obergrenze erreicht, z. B. für Termine, Orte oder offene Einladungen.

**Lösung:** Lösche nicht mehr benötigte Einträge oder widerrufe alte Einladungen. Die Werte stehen unter [Grenzen und Limits](help:support/limits).

## Import: Termine sind „Fehlerhaft“

**Symptom:** Im Import sind Termine mit **Fehlerhaft** markiert, oder es heißt „Termin der Datei nicht lesbar“.

**Ursache:** Der Termin hat Angaben, die der Kalender nicht annimmt (z. B. einen zu langen Namen), oder weder ein gültiges Datum noch einen Namen.

**Lösung:** Bearbeite den Termin in der Vorschau oder klicke auf **Fehlerhafte abwählen** und importiere den Rest. Es sind höchstens 5.000 Termine auf einmal möglich. Siehe [Import](help:organize/import).

## Kalender oder Feed nicht gefunden

**Symptom:** „Kalender nicht gefunden“, „Termin nicht gefunden“ oder „Feed nicht gefunden“.

**Ursache:** Der Link ist unvollständig oder veraltet, der Feed oder Termin wurde gelöscht oder nie veröffentlicht, oder alle gewählten Kalender sind archiviert.

**Lösung:** Frage beim Verein nach dem aktuellen Link. Admins prüfen den Feed unter **Veröffentlichen** ([Feeds](help:publishing/feeds)) und heben bei Bedarf die Archivierung auf ([Kalender](help:settings/calendars)).

## Kalender wird nicht geladen

**Symptom:** „Der Kalender wurde nicht geladen“ oder „Die Termine konnten nicht geladen werden“.

**Ursache:** Die Internetverbindung war unterbrochen.

**Lösung:** Prüfe deine Verbindung und klicke auf **Erneut laden**. Deine Auswahl bleibt erhalten.

## Siehe auch

- [Häufige Fragen](help:support/faq)
- [Grenzen und Limits](help:support/limits)
