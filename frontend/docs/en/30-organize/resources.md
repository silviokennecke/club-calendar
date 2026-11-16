---
title: Resources
order: 25
description: Mark locations as resources that can only be used once at a time.
---

# Resources

:::note
Only admins can create, change and delete resources. Viewers and editors can only see them.
:::

A resource is a location your club can only use once at a time, for example a hall or a room. Each resource belongs to a [location](help:organize/locations) and applies to the whole club.

## Where do I find them?

In the sidebar under **Club**, open **Places and audiences**, then the **Resources** tab.

![List of resources](shot:resources-list)

## Create a resource

1. Choose **Create resource**.
2. Choose the **Location**. Only locations that are not a resource yet are offered.
3. Check the **Name**. It starts as the name of the location.
4. Set who can see the resource, whether **Allow double booking** applies and how many hours of **buffer time** should lie between two events (0 to 24).
5. Choose **Save**.

![Dialog for creating a resource](shot:resources-form)

Even when double booking is allowed, overlaps are still shown as a warning.

## Calendar of a resource

Each resource has a **Calendar** button that opens a month and week view. It shows all events at this location from all calendars of the club, archived ones included.

![Calendar of a resource](shot:resources-calendar)

- Viewers see published events with their name and calendar; editors and admins also see drafts.
- Members without further rights only see when the resource is **Busy**, with the calendar and time, and only for resources that are visible to all members.
- The view is for looking things up only. You still create events in the calendar.

## When a resource is already booked

When you create or change an event, the form shows below the location whether the resource is already booked:

- **Yellow (warning)**: overlap with a draft, the buffer time is not kept, or overlap with a published event where double booking is allowed. You can still save and publish.
- **Red (error)**: overlap with a published event although double booking is not allowed. The event cannot be published then, also not through the bulk action, an event series, a template or the import. In these cases the app shows the same list and nothing is saved.

You can always save an event as a **draft**. Your input is kept when saving is refused.

## Edit and delete

Choose "edit" on a resource to change its name and settings. The location itself cannot be changed. When you delete a resource, the location stays; it just is no longer a resource.

## See also

- [Locations](help:organize/locations)
