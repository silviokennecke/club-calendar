---
title: Event series
order: 70
description: Create, change and delete recurring events as a series.
---

# Event series

A series creates many similar events at once, for example training every Tuesday.

:::note
You need the Editor or Admin role for this.
:::

## Create a series

A series is always created from a [template](help:organize/templates). Create a template first if you don't have one yet.

1. Open **All events** and click **Create event**.
2. Choose **From template**, then pick the template. Click **Next**.
3. Under **Kind**, choose **Event series**.
4. Choose the **Rhythm**:
   - **Weekly**
   - **Every two weeks**
   - **Monthly on the n-th weekday** (for example every 2nd Thursday or the last Friday of the month)
5. Choose the **Weekday** and the period with **From** and **To**. The series ends on the date you enter under **To**.
6. Turn on **Skip holidays** if no event should take place on public holidays.
7. Check the **Preview**. It lists every event that will be created. Skipped days are marked.
8. Click **Create … events as drafts**. With **Adjust first** you can change times, location or groups of the events beforehand.

![Event series from a template with rhythm, period and preview](shot:series-create-preview)

:::tip
The series starts as a draft. You can publish it right away under **Status of the series**, or later with a [bulk action](help:organize/bulk).
:::

A series has at most 366 events. If the period is too long you get a notice and shorten it.

Which days are skipped depends on your [holiday calendars](help:organize/holidays). Without a holiday calendar there are no holidays that could be skipped.

## Change or delete one event of a series

Events of a series show the note “Part of an event series”. When you save or delete, the app asks what should apply:

- **Only this event**: only this one event changes or disappears.
- **All events of the series**: the change applies to every event of the series. Anything you didn't touch stays as it is on each event.

:::note
A changed date always applies only to the event you are editing. The others keep their dates.
:::

Deleted events disappear from the calendar and from all feeds. This cannot be undone.

## Change the rule of the series

Want a different weekday, rhythm or a new end? Open an event of the series and click **Change series**.

1. Set the new rule. The previous rule is shown above for reference.
2. Under **What changes**, check which events are added, which are deleted and which stay unchanged.
3. Click **Change series** and confirm.

The new rule only changes future events from today on. Past events stay as they are.

:::warning
Future events that no longer fit the new rule are deleted. You see the impact in the preview first.
:::

## See also

- [Templates](help:organize/templates)
- [Holiday calendars](help:organize/holidays)
- [Change several events at once](help:organize/bulk)
