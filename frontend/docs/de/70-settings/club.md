---
title: Verein und Vereinsauswahl
order: 100
description: Vereinsname und Zeitzone, die Vereinsauswahl, weitere Vereine anlegen und zwischen Vereinen wechseln.
---

# Verein und Vereinsauswahl

Der Verein ist die oberste Ebene in Club Calendar: Er enthält alle Kalender, Mitglieder, Orte und Feeds. Du kannst Mitglied in mehreren Vereinen sein und jederzeit zwischen ihnen wechseln.

## Vereinsname ändern

:::note
Den Namen ändern darf nur ein **Admin**. Alle anderen sehen ihn, können ihn aber nicht bearbeiten.
:::

1. Öffne in der Seitenleiste **Verein verwalten**.
2. Auf dem Tab **Allgemeines** findest du **Vereinsname**.
3. Gib den neuen Namen ein und klicke auf **Namen speichern**.

Der Name erscheint in der Seitenleiste und für alle Mitglieder.

## Beitritt über Feeds

:::note
Das kann nur ein **Admin** ändern.
:::

Wer angemeldet einen Feed deines Vereins öffnet, kann dem Verein selbst beitreten. Die Person wird **Mitglied** und sieht nur, was für sie freigegeben ist, siehe [Rollen](help:getting-started/roles). Auf dem Reiter **Allgemeines** legst du unter **Beitritt über Feeds** fest, wer das darf:

- **Aus:** Niemand tritt über einen Feed bei. Personen kommen nur über Einladungen.
- **Nur über vereinsinterne Feeds:** Beitritt über Feeds mit „Nur per Link“ und über private Feeds (mit Geheimnis).
- **Auch über öffentliche Feeds:** Zusätzlich kann jede angemeldete Person über einen öffentlichen Feed beitreten.

Die Einstellung wird sofort gespeichert.

![Einstellung „Beitritt über Feeds“ mit den drei Auswahlmöglichkeiten](shot:club-feed-signup)

## Zeitzone des Vereins

Unter dem Titel der Seite **Verein verwalten** steht die Zeitzone des Vereins, zum Beispiel „Zeitzone Europe/Berlin“. Beim Anlegen des Vereins wird sie automatisch aus deinem Browser übernommen. In der Oberfläche kannst du sie nicht ändern.

Die Zeitzone wirkt sich so aus:

- Kalender, die keine eigene Zeitzone haben, verwenden die des Vereins. Alle Uhrzeiten deiner Termine gelten dann in dieser Zeitzone.
- Auf der öffentlichen Seite und in Abos zeigt ein Hinweis, dass alle Uhrzeiten in der Zeitzone des Vereins gelten.
- Ein einzelner Kalender kann eine andere Zeitzone haben, siehe [Einstellungen eines Kalenders](help:settings/calendar-settings).

## Zwischen Vereinen wechseln

- Über die Vereinsauswahl in der Seitenleiste wählst du **Verein wechseln**. Du landest im zuletzt genutzten Kalender dieses Vereins.
- **Alle Vereine anzeigen** (oder **Zu allen Vereinen** auf der Seite **Verein verwalten**) öffnet die Vereinsauswahl.

## Die Vereinsauswahl

Die Vereinsauswahl erreichst du unter `/clubs`. Dort siehst du jeden Verein als Karte mit Anzahl der Kalender und Mitglieder. Der zuletzt genutzte Verein ist mit **Zuletzt genutzt** markiert. Offene Einladungen siehst du ebenfalls dort, mehr dazu unter [Einladungen](help:team/invitations).

Nach dem Anmelden führt dich Club Calendar direkt in deinen zuletzt genutzten Kalender. Die Auswahl siehst du nur, wenn du sie über **Alle Vereine anzeigen** öffnest.

## Einen weiteren Verein anlegen

Jeder kann weitere Vereine anlegen. Du wirst dort automatisch Admin.

1. Öffne die Vereinsauswahl und klicke auf **Neuen Verein anlegen** (auch in der Seitenleiste unter dem Vereinswechsel).
2. Gib den **Namen deines Vereins** ein und klicke auf **Verein anlegen**.
3. Lege anschließend den ersten Kalender an.

Pro Person sind bis zu 50 Vereine möglich.

## Siehe auch

- [Kalender verwalten](help:settings/calendars)
- [Verein löschen](help:settings/delete-club)
- [Mitglieder](help:team/members)
