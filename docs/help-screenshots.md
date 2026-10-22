# Screenshots for the help page `/help/subscribe`

The page shows one optional screenshot per step. Files go to `frontend/public/help/` (the folder is kept by
`.gitkeep`). A missing file is fine: the figure disappears and the step shows text only.

Format: PNG, at most 1170 px wide (shown at up to 420 px, aspect ratio 1170 x 820 is reserved), no personal data
(use a neutral demo club and account). Names are `<app>-<step number>.png`; the step order is defined in
`frontend/src/components/help/guides.ts`.

## ios (iPhone, Settings)

| File | Step | Must show |
| --- | --- | --- |
| `ios-1.png` | settings | Home screen with the Settings app icon highlighted |
| `ios-2.png` | apps | Settings > Apps list, the Calendar row highlighted |
| `ios-3.png` | accounts | Calendar settings, Calendar Accounts, the "Account hinzufügen" row highlighted |
| `ios-4.png` | other | Account type list scrolled down, "Andere" and "Kalenderabo hinzufügen" highlighted |
| `ios-5.png` | paste | Subscription form, the "Server" field filled with a sample link, the "Einsetzen" bubble visible |
| `ios-6.png` | next | Same form, "Weiter" at the top right highlighted |
| `ios-7.png` | save | Settings form, "Sichern" at the top right highlighted |

## macos (Kalender app)

| File | Step | Must show |
| --- | --- | --- |
| `macos-1.png` | open | Dock with the Kalender icon highlighted |
| `macos-2.png` | menu | Open "Ablage" menu with "Neues Kalenderabonnement…" highlighted |
| `macos-3.png` | paste | Subscription dialog with a sample link in the field and "Abonnieren" highlighted |
| `macos-4.png` | name | Settings dialog: fields for name and color |
| `macos-5.png` | refresh | Same dialog, "Automatisch aktualisieren" pop-up open with "Alle 15 Minuten" |
| `macos-6.png` | ok | Same dialog, "OK" at the bottom right highlighted |

## outlook (Outlook on the web / new Outlook)

| File | Step | Must show |
| --- | --- | --- |
| `outlook-1.png` | open | Outlook with the calendar view open |
| `outlook-2.png` | add | Left bar with "Kalender hinzufügen" highlighted |
| `outlook-3.png` | internet | Add dialog with "Aus dem Internet abonnieren" highlighted |
| `outlook-4.png` | paste | Link field filled with a sample link |
| `outlook-5.png` | name | Name field filled (e.g. "Verein") |
| `outlook-6.png` | import | Same dialog, "Importieren" highlighted |

## google (calendar.google.com on a computer)

| File | Step | Must show |
| --- | --- | --- |
| `google-1.png` | open | Google Calendar in the browser |
| `google-2.png` | plus | Left bar, the plus next to "Weitere Kalender" highlighted |
| `google-3.png` | url | Plus menu with "Per URL" highlighted |
| `google-4.png` | paste | "URL des Kalenders" field filled with a sample link |
| `google-5.png` | add | Same page, "Kalender hinzufügen" highlighted |
