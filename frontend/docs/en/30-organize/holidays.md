---
title: Holidays and school breaks
order: 80
description: Link holiday and school-break calendars as predefined (OpenHolidays) or through an ICS address.
---

# Holidays and school breaks

With a holiday calendar, your calendar shows public holidays or school breaks. In [event series](help:organize/series) you can skip these days automatically.

:::note
Every member can view them. To add, update or delete you need the Editor or Admin role.
:::

## Add a holiday calendar

Open the calendar **Settings** and switch to the **Holidays** tab. Under **Source** you have two options.

### Predefined (OpenHolidays)

The easiest way: public holidays and school breaks come ready-made from the free OpenHolidays database.

1. Under **Source**, choose **Predefined (OpenHolidays)**.
2. The **Country** is preset to Germany. Choose another one if needed.
3. Optionally choose a **State / region**. With **Whole country** the entries apply nationwide.
4. Under **What should be imported?**, tick what you need: **Public holidays**, **School holidays** or both. At least one type is required.
5. Click **Import**.

Each chosen type becomes its own calendar. The app stores the data itself. If the selection lists cannot be loaded, you can still import with the defaults. If the source is unreachable, try again later.

### ICS address

You need the web address (ICS address) of a holiday or school-break calendar. It starts with `https://` and usually ends in `.ics`.

1. Under **Source**, choose **ICS address**.
2. Enter a **Name**, for example "School breaks Bavaria".
3. Choose the **Type**: **Public holidays**, **School holidays** or **Other**.
4. Enter the **ICS address**.
5. Click **Add and fetch**.

The app loads the entries right away and shows how many were added. You can link several holiday calendars.

![Settings, Holidays tab with a linked calendar and the add form](shot:holidays-settings)

## Preview and updating

- **Show holidays of the next 12 months** lists the days the calendar contains.
- The list shows when the source was last fetched. **Update now** fetches new entries. If that fails, the holidays fetched last are kept.
- The app refreshes predefined calendars automatically when the last fetch is older than three months.

## Where do holidays appear?

- In the views of your calendar, so you see what falls on a holiday when planning.
- In the series preview: with **Skip holidays**, these days are left out of the [event series](help:organize/series). There you choose which holiday calendars apply.
- In the [PDF export](help:organize/export), when you select the holiday calendars there.
- In the web view of a [feed](help:publishing/feeds). The ICS file of a feed contains events only, no holidays.

## Remove

Use the delete icon next to the calendar to remove it. Your own events stay unchanged, and so does the source on the internet. The holidays disappear from the calendar and can no longer be skipped in series.

## See also

- [Event series](help:organize/series)
- [Calendar settings](help:settings/calendar-settings)
