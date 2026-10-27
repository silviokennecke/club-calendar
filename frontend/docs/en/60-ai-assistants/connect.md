---
title: Connect an assistant
order: 10
description: How to add the club calendar in an AI app and allow access.
---

# Connect an assistant

In your AI app you add the address of the club calendar as a "connector" (also called "connection" or "MCP server", depending on the app). Then you allow access once in the club calendar.

## Supported apps

By default Claude, ChatGPT (OpenAI) and Gemini are allowed. Whoever runs your club calendar can change this list. If the connection does not work, ask them.

## How to connect an app

1. In your AI app, open the settings for connectors (called "connectors", "apps" or "connections", depending on the app) and choose to add a custom connector.
2. Enter the address of your own installation:

   `https://<your-domain>/api/mcp`

   Replace `<your-domain>` with the address you use to open the club calendar in your browser.

3. The app sends you to the club calendar. Sign in if needed.
4. You see the page **Connect app?**. Check the details (see below) and click **Allow**. **Deny** cancels.
5. You return to the AI app. The connection is set up.

:::note
You need a confirmed account: confirm your e-mail address and accept the current documents first, otherwise the app cannot be connected.
:::

## What to check on the "Connect app?" page

- **App**: The name the app gives itself. This name is not verified.
- **Redirects to**: The address you are sent back to afterwards. It should match the app you are connecting.
- **Unverified app**: If you see this notice, the app does not belong to a known provider. Only allow access if you trust it and expect the redirect address.
- **What the app may do**: Either only view (clubs, calendars, events, templates and feeds) or additionally create drafts and reference data. In the second case the page also says: the app cannot publish anything or delete events, new events stay drafts.

:::warning
If you did not start the connection yourself, click **Deny**.
:::

## If it does not work

- "Request expired": The request is only valid for a short time or was already answered. Start the connection in the AI app again.
- Message about too many apps: You can connect at most 20 apps. Disconnect one first in your [profile](help:ai-assistants/manage-access).

## See also

- [Manage access](help:ai-assistants/manage-access)
- [What assistants can do](help:ai-assistants/capabilities)
