---
title: Club and club picker
order: 100
description: Club name and time zone, the club picker, creating more clubs and switching between clubs.
---

# Club and club picker

The club is the top level in Club Calendar: it holds all calendars, members, locations and feeds. You can be a member of several clubs and switch between them at any time.

## Change the club name

:::note
Only an **Admin** can change the name. Everyone else can see it but not edit it.
:::

1. Open **Manage club** in the sidebar.
2. On the **General** tab you find **Club name**.
3. Enter the new name and click **Save name**.

The name appears in the sidebar and for all members.

## Joining through feeds

:::note
Only an **Admin** can change this.
:::

People who open a feed of your club while signed in can join the club by themselves. They become **Members** and only see what is shared with them, see [Roles](help:getting-started/roles). On the **General** tab, **Joining through feeds** decides who may do this:

- **Off:** nobody joins through a feed. People come in only through invitations.
- **Club-internal feeds only:** joining works through "Club-internal" feeds and through private feeds (with the secret).
- **Also through public feeds:** additionally, any signed-in person can join through a public feed.

The setting is saved right away.

![The “Joining through feeds” setting with its three choices](shot:club-feed-signup)

## The club's time zone

Under the title of the **Manage club** page you see the club's time zone, for example "Time zone Europe/Berlin". It is taken from your browser automatically when the club is created. You cannot change it in the interface.

The time zone has these effects:

- Calendars without their own time zone use the club's. All times of your events then apply in that time zone.
- On the public page and in subscriptions, a note says that all times apply in the club's time zone.
- A single calendar can have a different time zone, see [Calendar settings](help:settings/calendar-settings).

## Switch between clubs

- In the sidebar, use the club picker and choose **Switch club**. You land in the most recently used calendar of that club.
- **Show all clubs** (or **All clubs** on the **Manage club** page) opens the club picker.

## The club picker

You reach the club picker at `/clubs`. It shows each club as a card with the number of calendars and members. The club you used last is marked **Last used**. Open invitations also appear there, see [Invitations](help:team/invitations).

After signing in, Club Calendar takes you straight to your last used calendar. You only see the picker when you open it via **Show all clubs**.

## Create another club

Anyone can create more clubs. You become the Admin of the new club.

1. Open the club picker and click **Create new club** (also available in the sidebar under the club switcher).
2. Enter the **Name of your club** and click **Create club**.
3. Then create the first calendar.

Each person can be in up to 50 clubs.

## See also

- [Managing calendars](help:settings/calendars)
- [Delete a club](help:settings/delete-club)
- [Members](help:team/members)
