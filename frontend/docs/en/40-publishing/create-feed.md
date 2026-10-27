---
title: Create and manage a feed
order: 20
description: How to create a feed, change it, copy its address and delete it.
---

:::note
You need the admin role for this. Editors can only view feeds, viewers do not see them.
:::

## Create a feed

1. Open **Publish** and click **Create feed**.
2. Enter a **Name**, e.g. "Public calendar". It only appears in your overview.
3. Under **Calendars**, select at least one calendar.
4. Choose the **Visibility**: **Public**, **Link only** or **Private (protected)**. More in [What is a feed?](help:publishing/feeds#the-three-visibilities).
5. Optionally select **Audiences**. Without a selection the feed contains all audiences.
6. Click **Save feed**.

![Create feed form with name, calendars, visibility and audiences](shot:create-feed-form)

## Copy the address

After saving, the web view address appears under **Addresses**. You can copy it or look at it with **Open**. In the overview, **Show addresses** reveals them. Pass them on to members and guests. How they subscribe is described in [Subscribe to a calendar](help:publishing/subscribe).

## Change a feed

In the overview click **Edit** on the feed, change the details and save. The address stays the same.

## Secret of private feeds

A private feed has a **Secret** that is part of every address. Anyone who knows the address can read the feed. Only share it with people who should see the calendar.

- **Regenerate secret:** the feed gets new addresses. Existing subscriptions stop working and everyone must enter the new subscription address. Use this if the link fell into the wrong hands.
- **Remove the secret:** set the visibility to **Link only** or **Public** and confirm **Save without secret**. Afterwards anyone with the link can see the calendar.

## Delete a feed

Click **Delete feed** and confirm. The link no longer works afterwards, and subscriptions receive no more updates.

:::tip
If you delete a calendar, feeds that contain only that calendar are deleted with it. Other feeds just lose that calendar.
:::

## See also

- [What is a feed?](help:publishing/feeds)
- [The public view](help:publishing/public-view)
