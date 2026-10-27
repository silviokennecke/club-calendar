---
title: Import events
order: 100
description: Bring events from an ICS file into your calendar.
---

# Import events

If you have events in another calendar app or in a spreadsheet, you can export them as an ICS file and bring them in here. An ICS file is a standard format for calendar events.

:::note
You need the Editor or Admin role for this. Archived calendars can't be imported into.
:::

## Step by step

1. Open **Import events** in the sidebar. Or click "Or import events from an ICS file" under **Create event**.
2. **File:** Drag the file into the box or pick it with **Choose file**. Only files ending in `.ics` are accepted. The app shows how many events it found. Click **Review file**.
3. **Review:** You see all events, grouped by name. Nothing is created yet. Choose which events to take over (see below).
4. Click **Import … events**.
5. **Done:** A summary shows what was imported. Use **To the calendar** or **View all events** to see the result.

![Import review step with a possible-duplicates notice](shot:import-review)

## Review the events

Every event has a checkbox. Only ticked events are imported.

- **Possible duplicate:** the event already exists in the calendar (same identifier in the file or same name on the same day). **Deselect duplicates** skips them all at once.
- **Invalid:** the event has details the calendar does not accept, for example a name that is too long. Edit it or deselect it. **Deselect invalid events** does this for all of them.
- **Time zone replaced:** the file names a time zone the calendar doesn't know. The event is created in the calendar's time zone. Check the time after the import.
- Events without a valid date or without a name are skipped.

## Edit events

Use the edit icon to change a single event or, with **Edit group**, all events of a group. The date stays as in the file. Changes apply to the import only; your file is not modified.

At the top, **Set for all selected events** lets you set details for all ticked events, such as status, badges, extras and audiences.

## Locations

If the file names a location your club doesn't have yet, it is created as a new location during the import. The review shows **New location: …**; an existing one is shown as **Existing location: …**. You can complete new locations later under [Locations](help:organize/locations).

## Draft or published?

Imported events are created as drafts by default, so only your club sees them. You can publish them later, for example with a [bulk action](help:organize/bulk). If you choose **Published** during the import, they are visible in public feeds right away.

## Recurrences and limits

- Recurring events in the file are expanded into single events and imported as single events, not as an [event series](help:organize/series). At most 366 events are taken per recurrence; for recurrences without an end, the first two years. Unsupported recurrences give only the first event.
- At most 5000 events per import. If the file has more, select fewer and import the rest in a second run.
- A calendar holds at most 20000 events.
- If the file is not UTF-8 encoded, the app tells you. Then check umlauts and special characters.

:::tip
If the import fails, nothing is created. You can simply try again.
:::

## See also

- [Export events](help:organize/export)
- [Change several events at once](help:organize/bulk)
