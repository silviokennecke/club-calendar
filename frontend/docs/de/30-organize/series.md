---
title: Terminserien
order: 70
description: Wiederkehrende Termine als Serie anlegen, ändern und löschen.
---

# Terminserien

Mit einer Terminserie legst du viele gleichartige Termine auf einmal an, zum Beispiel das Training jeden Dienstag.

:::note
Dafür brauchst du die Rolle Bearbeiter oder Admin.
:::

## Serie anlegen

Eine Serie entsteht immer aus einer [Vorlage](help:organize/templates). Lege also zuerst eine Vorlage an, falls du noch keine hast.

1. Öffne **Alle Termine** und öffne das Menü neben **Termin anlegen**.
2. Wähle **Aus Vorlage** und dann die gewünschte Vorlage. Klicke auf **Weiter**.
3. Wähle bei **Art** den Eintrag **Terminserie**.
4. Wähle den **Rhythmus**:
   - **Wöchentlich**
   - **Zweiwöchentlich**
   - **Monatlich am n-ten Wochentag** (zum Beispiel jeden 2. Donnerstag oder den letzten Freitag im Monat)
5. Wähle den **Wochentag** und den Zeitraum mit **Von** und **Bis**. Die Serie endet an dem Datum, das du bei **Bis** einträgst.
6. Schalte **Feiertage auslassen** ein, wenn an Feiertagen kein Termin stattfinden soll.
7. Prüfe die **Vorschau**. Dort siehst du jeden Termin, der entsteht. Ausgelassene Tage sind markiert.
8. Klicke auf **… Termine als Entwurf anlegen**. Mit **Vorher anpassen** kannst du zuerst Zeiten, Ort oder Gruppen der Termine ändern.

![Terminserie aus Vorlage mit Rhythmus, Zeitraum und Vorschau](shot:series-create-preview)

:::tip
Die Serie startet als Entwurf. Du kannst sie unter **Status der Serie** gleich veröffentlichen oder später per [Sammelaktion](help:organize/bulk).
:::

Eine Serie hat höchstens 366 Termine. Ist der Zeitraum zu lang, bekommst du einen Hinweis und verkürzt ihn.

Welche Tage ausgelassen werden, hängt von deinen [Feiertagskalendern](help:organize/holidays) ab. Ohne eingebundenen Feiertagskalender gibt es keine Feiertage, die entfallen können.

## Einen Termin der Serie ändern oder löschen

Termine einer Serie zeigen den Hinweis „Teil einer Terminreihe“. Beim Speichern oder Löschen fragt dich die App, was gelten soll:

- **Nur diesen Termin**: Nur dieser eine Termin ändert sich oder verschwindet.
- **Alle Termine der Reihe**: Die Änderung gilt für jeden Termin der Serie. Was du nicht angefasst hast, bleibt bei jedem Termin, wie es ist.

:::note
Ein geändertes Datum gilt immer nur für den Termin, den du bearbeitest. Die anderen behalten ihr Datum.
:::

Gelöschte Termine verschwinden aus dem Kalender und aus allen Feeds. Das lässt sich nicht rückgängig machen.

## Die Regel der Serie ändern

Du willst einen anderen Wochentag, Rhythmus oder ein neues Ende? Öffne einen Termin der Serie und klicke auf **Reihe ändern**.

1. Stelle die neue Regel ein. Die bisherige Regel steht zur Orientierung darüber.
2. Prüfe unter **Auswirkungen**, welche Termine neu dazukommen, welche gelöscht werden und welche unverändert bleiben.
3. Klicke auf **Reihe ändern** und bestätige.

Die neue Regel ändert nur künftige Termine ab heute. Vergangene Termine bleiben, wie sie sind.

:::warning
Künftige Termine, die nicht mehr zur neuen Regel passen, werden gelöscht. Die Auswirkungen siehst du vorher in der Vorschau.
:::

## Siehe auch

- [Vorlagen](help:organize/templates)
- [Feiertagskalender](help:organize/holidays)
- [Mehrere Termine gleichzeitig ändern](help:organize/bulk)
