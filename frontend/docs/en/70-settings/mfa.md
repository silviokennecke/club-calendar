---
title: Two-step sign-in (MFA)
order: 25
description: Set up a second step at sign-in with an authenticator app or a passkey.
---

# Two-step sign-in (MFA)

With two-step sign-in (MFA), signing in with your password also asks for a second step: a code from an authenticator app or a passkey.

You find the section in your [profile](help:settings/profile) under **Two-factor authentication (MFA)**.

## Set up an authenticator app

1. In the section, click **Add MFA method**.
2. Choose **Authenticator app** and click **Next**.
3. Scan the QR code with your app. If you cannot scan it, enter the **Setup key** in your app.
4. Enter the 6-digit code your app shows under **Code from the app**.
5. Store your **Backup codes** safely (see below). Tick **I stored the backup codes** and click **Continue**.
6. Confirm that it is you: enter your password and click **Activate**. If your account has no password, click **Send code** and enter the code from the e-mail.

You can set up only one authenticator app. Instead of an app, you can also choose a **Passkey** as the second step in the same dialog.

## Turn on MFA with a passkey you already have

If you already have a passkey, you can turn on MFA with it. The **Turn on MFA** button appears when MFA is off and you have at least one passkey.

1. Click **Turn on MFA**.
2. Store the backup codes safely, tick **I stored the backup codes** and click **Continue**.
3. Confirm that it is you and click **Turn on MFA**.

## When signing in

After your password, sign-in asks for the second step. You have three options:

- **Use the code from your authenticator app**: enter the current 6-digit code.
- **Use a backup code**: enter one of your backup codes.
- **Use a passkey**: confirm on the device with your passkey.

When you sign in with Google, Microsoft or a passkey, sign-in does not ask for the second step.

## Backup codes

Backup codes are spare codes in case you cannot use your authenticator app. You get them when you set up MFA. Each code works only once. Keep them in a safe place.

To get new codes, click **Regenerate** next to **Backup codes** in the section. Confirm, click **Generate codes** and store the new codes. The old codes stop working.

## Lost your phone

:::warning
If you sign in with a backup code, MFA is turned off. The authenticator app and the backup codes are deleted, and all other devices are signed out.
:::

Sign in with your password, choose **Use a backup code** and enter one code. Then set up MFA again in your profile with a new authenticator app.

## Turn off MFA

1. In the section, click **Disable MFA**.
2. Confirm that it is you: enter your password (without a password: the code from the e-mail) and click **Disable MFA**.

The authenticator app and the backup codes are deleted. Your passkeys stay. All other devices are signed out.

:::note
While MFA is on and no authenticator app is set up, you cannot remove your last passkey.
:::

## See also

- [Passkeys](help:settings/passkeys)
- [Password](help:settings/password)
- [Sessions and signing out](help:settings/sessions)
