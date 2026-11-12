---
title: Assistenten verbinden
order: 10
description: So fügst du den Vereinskalender in einer KI-App hinzu und erlaubst den Zugriff.
---

# Assistenten verbinden

Du fügst in deiner KI-App die Adresse des Vereinskalenders als „Connector“ (je nach App auch „Verbindung“ oder „MCP-Server“) hinzu. Danach erlaubst du den Zugriff einmal im Vereinskalender.

## Unterstützte Apps

Standardmäßig sind Claude, ChatGPT (OpenAI) und Gemini freigegeben. Wer den Vereinskalender betreibt, kann diese Liste ändern. Klappt die Verbindung nicht, frag dort nach.

## So verbindest du eine App

1. Öffne in deiner KI-App die Einstellungen für Connectors (je nach App „Konnektoren“, „Apps“ oder „Verbindungen“) und wähle, einen eigenen Connector hinzuzufügen.
2. Trage als Adresse die deiner eigenen Installation ein:

   `https://<deine-domain>/api/mcp`

   Ersetze `<deine-domain>` durch die Adresse, unter der du den Vereinskalender im Browser öffnest.

3. Die App leitet dich zum Vereinskalender weiter. Melde dich an, falls nötig.
4. Du siehst die Seite **App verbinden?**. Prüfe die Angaben (siehe unten) und klicke auf **Erlauben**. Mit **Ablehnen** brichst du ab.
5. Die App fragt, ob du es bist. Bestätige es (siehe [Bestätigen, dass du es bist](help:settings/confirmation)). Abbrechen lässt die Seite offen.
6. Du landest wieder in der KI-App. Die Verbindung steht.

:::note
Du brauchst ein bestätigtes Konto: Bestätige zuerst deine E-Mail-Adresse und stimme den aktuellen Dokumenten zu, sonst kann die App nicht verbunden werden.
:::

## Was du auf der Seite „App verbinden?“ prüfst

- **App**: Claude, ChatGPT oder Gemini, wenn die Weiterleitungsadresse zu diesem Anbieter passt, sonst „Unbekannte App“. Das wird nur an der Adresse erkannt und ist keine Bestätigung des Anbieters.
- **Angabe der App**: Der Name, den sich die App selbst gibt („Nennt sich …“). Er wird nicht überprüft und kann beliebig gewählt sein.
- **Weiterleitung nach**: Die Adresse, zu der du danach zurückgeschickt wirst. Sie sollte zu der App passen, die du gerade verbindest.
- **Nicht verifizierte App**: Siehst du diesen Hinweis, gehört die App nicht zu den bekannten Anbietern. Erlaube den Zugriff nur, wenn du ihr vertraust und die Weiterleitungsadresse erwartest.
- **Programm auf einem Computer / Eigener ChatGPT-Konnektor**: Diese Hinweise erscheinen, wenn die Weiterleitung an ein lokales Programm geht oder an einen ChatGPT-Konnektor, den jeder selbst anlegen kann. Erlaube den Zugriff nur, wenn du die Verbindung selbst gestartet bzw. den Konnektor selbst eingerichtet hast.
- **Das darf die App**: Entweder nur ansehen (Vereine, Kalender, Termine, Vorlagen und Feeds) oder zusätzlich Entwürfe und Stammdaten anlegen. Im zweiten Fall steht dort auch: Die App kann nichts veröffentlichen und keine Termine löschen, neue Termine bleiben Entwürfe.

:::warning
Hast du die Verbindung nicht selbst gestartet, klicke auf **Ablehnen**.
:::

## Wenn es nicht klappt

- „Anfrage abgelaufen“: Die Anfrage gilt nur kurz, wurde schon beantwortet oder wurde in einem anderen Browser gestartet. Öffne den Link im selben Browser, in dem du die Verbindung gestartet hast, und starte die Verbindung in der KI-App noch einmal.
- Meldung zu zu vielen Apps: Du kannst höchstens 20 Apps verbinden. Trenne zuerst eine im [Profil](help:ai-assistants/manage-access).

## Siehe auch

- [Zugriff verwalten](help:ai-assistants/manage-access)
- [Was Assistenten können](help:ai-assistants/capabilities)
