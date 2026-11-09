---
title: Create and manage a feed
order: 20
description: How to create a feed, change it, copy its address and delete it.
---

# Create and manage a feed

:::note
You need the admin role for this. Editors can only view feeds, viewers and members do not see them.
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

- **Regenerate secret:** the feed gets new addresses. Existing subscriptions stop working and everyone must enter the new subscription address. Use this if the link fell into the wrong hands. If people joined the feed themselves with the secret, you can tick **Withdraw access from members who joined this feed themselves**. Members you assigned keep their access.
- **Remove the secret:** set the visibility to **Link only** or **Public** and confirm **Save without secret**. Afterwards anyone with the link can see the calendar.

## Give members access to a private feed

Club members can read a private feed without knowing the secret if you assign them to it. Open the private feed; under **Assigned members** you see who has access.

1. Click **Add**.
2. Search for members by name or e-mail and select them, or paste a list of e-mail addresses (one per line or separated by commas). Only addresses of existing club members are added.
3. Confirm with **Add** and then **Done**.

The list shows whether someone was **Assigned** by you or **Joined themselves** with the secret. Search and filter help in long lists. To take access away, click **Remove** or select several people and click **Remove selected**. They stay club members, they just no longer see the feed. Editors and admins always read feeds through their role.

## Delete a feed

Click **Delete feed** and confirm. The link no longer works afterwards, and subscriptions receive no more updates.

:::tip
If you delete a calendar, feeds that contain only that calendar are deleted with it. Other feeds just lose that calendar.
:::

## See also

- [What is a feed?](help:publishing/feeds)
- [The public view](help:publishing/public-view)
