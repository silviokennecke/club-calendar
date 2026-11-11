---
title: Termine importieren
order: 100
description: Termine aus einer ICS-Datei in deinen Kalender übernehmen.
---

# Termine importieren

Hast du Termine in einer anderen Kalender-App oder Tabelle, kannst du sie als ICS-Datei exportieren und hier übernehmen. Eine ICS-Datei ist ein Standardformat für Kalendertermine.

:::note
Dafür brauchst du die Rolle Bearbeiter oder Admin. In einem archivierten Kalender ist kein Import möglich.
:::

## Schritt für Schritt

1. Öffne das Menü neben **Termin anlegen** und wähle **Termine importieren**.
2. **Datei:** Ziehe die Datei in das Feld oder wähle sie mit **Datei auswählen**. Es werden nur Dateien mit der Endung `.ics` angenommen. Die App zeigt, wie viele Termine sie erkannt hat. Klicke auf **Datei prüfen**.
3. **Prüfen:** Du siehst alle Termine, gruppiert nach Namen. Es wird noch nichts angelegt. Wähle aus, welche Termine du übernehmen willst (siehe unten).
4. Klicke auf **… Termine importieren**.
5. **Fertig:** Eine Zusammenfassung zeigt, was importiert wurde. Mit **Zum Kalender** oder **Alle Termine ansehen** schaust du dir das Ergebnis an.

![Importschritt Prüfen mit Hinweis auf mögliche Doppelte](shot:import-review)

## Termine prüfen

Jeder Termin hat ein Häkchen. Nur angehakte Termine werden importiert.

- **Möglicherweise doppelt:** Den Termin gibt es im Kalender schon (gleiche Kennung aus der Datei oder gleicher Name am selben Tag). Mit **Doppelte abwählen** überspringst du alle auf einmal.
- **Fehlerhaft:** Der Termin hat Angaben, die der Kalender nicht annimmt, zum Beispiel einen zu langen Namen. Bearbeite ihn oder wähle ihn ab. Mit **Fehlerhafte abwählen** gelingt das für alle.
- **Zeitzone ersetzt:** Die Datei nennt eine Zeitzone, die der Kalender nicht kennt. Der Termin wird in der Zeitzone des Kalenders angelegt. Prüfe die Uhrzeit nach dem Import.
- Termine ohne gültiges Datum oder ohne Namen werden übersprungen.

## Termine bearbeiten

Über das Bearbeiten-Symbol änderst du einen einzelnen Termin oder, mit **Gruppe bearbeiten**, alle Termine einer Gruppe. Das Datum bleibt dabei wie in der Datei. Die Änderungen gelten nur für den Import, deine Datei bleibt unverändert.

Oben unter **Für alle ausgewählten Termine setzen** legst du Angaben für alle angehakten Termine fest, zum Beispiel Status, Besonderheiten, Zusatzangebote und Gruppen.

## Orte

Nennt die Datei einen Ort, den es in deinem Verein noch nicht gibt, wird er beim Import als neuer Ort angelegt. In der Prüfung steht **Neuer Ort: …**, ein vorhandener Ort heißt **Vorhandener Ort: …**. Neue Orte kannst du später unter [Orte](help:organize/locations) ergänzen.

## Entwurf oder veröffentlicht?

Importierte Termine werden standardmäßig als Entwurf angelegt, sind also nur für deinen Verein sichtbar. Du kannst sie später veröffentlichen, zum Beispiel per [Sammelaktion](help:organize/bulk). Wählst du beim Import **Veröffentlicht**, sind sie sofort in öffentlichen Feeds sichtbar.

## Wiederholungen und Grenzen

- Wiederholungen aus der Datei werden in einzelne Termine aufgelöst und als Einzeltermine importiert, nicht als [Terminserie](help:organize/series). Pro Wiederholung werden höchstens 366 Termine übernommen, bei Wiederholungen ohne Ende die ersten zwei Jahre. Nicht unterstützte Wiederholungen ergeben nur den ersten Termin.
- Pro Import sind höchstens 5000 Termine möglich. Hat die Datei mehr, wähle weniger aus und importiere den Rest in einem zweiten Durchgang.
- Pro Kalender gibt es höchstens 20000 Termine.
- Ist die Datei nicht UTF-8-kodiert, weist die App darauf hin. Prüfe dann Umlaute und Sonderzeichen.

:::tip
Schlägt der Import fehl, wird nichts angelegt. Du kannst es ohne Aufräumen erneut versuchen.
:::

## Siehe auch

- [Termine exportieren](help:organize/export)
- [Mehrere Termine gleichzeitig ändern](help:organize/bulk)
