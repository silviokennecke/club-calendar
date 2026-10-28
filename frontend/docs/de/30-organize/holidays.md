---
title: Feiertage und Ferien
order: 80
description: Feiertags- und Ferienkalender vordefiniert (OpenHolidays) oder über eine ICS-Adresse einbinden.
---

# Feiertage und Ferien

Mit einem Feiertagskalender zeigt dein Kalender gesetzliche Feiertage oder Schulferien an. In [Terminserien](help:organize/series) kannst du diese Tage automatisch auslassen.

:::note
Ansehen kann jedes Mitglied. Zum Hinzufügen, Aktualisieren und Löschen brauchst du die Rolle Bearbeiter oder Admin.
:::

## Feiertagskalender hinzufügen

Öffne die **Einstellungen** des Kalenders und wechsle zum Tab **Feiertage**. Bei **Quelle** hast du zwei Möglichkeiten.

### Vordefiniert (OpenHolidays)

Die einfachste Variante: Gesetzliche Feiertage und Schulferien kommen fertig aus der freien Datenbank OpenHolidays.

1. Wähle bei **Quelle** den Eintrag **Vordefiniert (OpenHolidays)**.
2. Das **Land** ist mit Deutschland vorbelegt. Wähle bei Bedarf ein anderes.
3. Wähle optional ein **Bundesland / Region**. Mit **Ganzes Land** gelten die Einträge landesweit.
4. Markiere bei **Was soll importiert werden?**, was du brauchst: **Feiertage**, **Schulferien** oder beides. Mindestens eine Art ist nötig.
5. Klicke auf **Importieren**.

Für jede gewählte Art entsteht ein eigener Kalender. Die Daten speichert die App bei dir. Sind die Auswahllisten einmal nicht erreichbar, kannst du trotzdem mit den Standardwerten importieren. Ist die Quelle nicht erreichbar, versuche es später erneut.

### ICS-Adresse

Du brauchst die Internetadresse (ICS-Adresse) eines Feiertags- oder Ferienkalenders. Sie beginnt mit `https://` und endet meist auf `.ics`.

1. Wähle bei **Quelle** den Eintrag **ICS-Adresse**.
2. Gib einen **Namen** ein, zum Beispiel „Schulferien Bayern“.
3. Wähle die **Art**: **Feiertage**, **Schulferien** oder **Sonstiges**.
4. Trage die **ICS-Adresse** ein.
5. Klicke auf **Hinzufügen und abrufen**.

Die App lädt die Einträge sofort und zeigt, wie viele hinzugekommen sind. Du kannst mehrere Feiertagskalender einbinden.

![Einstellungen, Tab Feiertage mit eingebundenem Kalender und Formular](shot:holidays-settings)

## Vorschau und Aktualisieren

- Mit **Feiertage der nächsten 12 Monate anzeigen** siehst du, welche Tage der Kalender enthält.
- Die Liste zeigt, wann die Quelle zuletzt abgerufen wurde. Mit **Jetzt aktualisieren** holst du neue Einträge. Klappt das nicht, bleiben die zuletzt abgerufenen Feiertage erhalten.
- Vordefinierte Kalender aktualisiert die App automatisch, wenn der letzte Abruf älter als drei Monate ist.

## Wo erscheinen die Feiertage?

- In den Ansichten deines Kalenders, damit du bei der Planung siehst, was auf einen Feiertag fällt.
- In der Serienvorschau: Mit **Feiertage auslassen** fallen diese Tage aus der [Terminserie](help:organize/series). Du wählst dort, welche Feiertagskalender gelten.
- Im [PDF-Export](help:organize/export), wenn du die Feiertagskalender dort auswählst.
- In der Webansicht eines [Feeds](help:publishing/feeds). In der ICS-Datei eines Feeds stehen dagegen nur Termine, keine Feiertage.

## Entfernen

Über das Löschen-Symbol neben dem Kalender entfernst du ihn. Deine eigenen Termine bleiben unverändert, die Quelle im Internet auch. Die Feiertage verschwinden aus dem Kalender und lassen sich in Serien nicht mehr auslassen.

## Siehe auch

- [Terminserien](help:organize/series)
- [Kalender-Einstellungen](help:settings/calendar-settings)
