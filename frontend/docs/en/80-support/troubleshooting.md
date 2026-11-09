---
title: Solving problems
order: 30
description: Common messages and error situations with cause and solution.
---

# Solving problems

For every situation you find the **symptom** (what you see), the **cause** and the **solution**.

## Sign-in fails

**Symptom:** You cannot get in, or you see "Too many attempts" or "Too many attempts. Please try again in about ... min."

**Cause:** E-mail or password are wrong, or there were too many attempts in a short time. The app then briefly blocks sign-in to protect your account.

**Solution:** Wait for the time shown. Check the spelling of your address. If you forgot your password, reset it from the sign-in page ([Password](help:settings/password)). Or sign in with a [passkey](help:settings/passkeys) or a [linked account](help:settings/linked-accounts).

## Password reset required or browser not supported

**Symptom:** The sign-in page shows **Password reset required**, or the message "Your browser or device does not support secure sign-in" or "Secure sign-in is currently unavailable".

**Cause:** After the switch to the new password check, your account did not sign in before the cutoff date and still has the old password procedure. Or your browser does not support WebAssembly or has too little memory.

**Solution:** Reset your password from the sign-in page ([Password](help:settings/password)). Use a current browser. If secure sign-in is only unavailable for a moment, try again later.

## Sign-in with Google, Microsoft or Apple fails

**Symptom:** Messages such as "The sign-in has expired ...", "An account already exists for this e-mail address" or "No account was created. Registration is only possible with an invitation."

**Cause:** The sign-in was started in another browser window or took too long; the address already belongs to an account; or your club only allows new accounts by invitation.

**Solution:** Start the sign-in again in the same window. Sign in the way you did before. For "invitation only", ask your club's admins to invite exactly this address ([Invitations](help:team/invitations)).

## E-mail not confirmed, code expired

**Symptom:** "The code is wrong, expired or used up." or after signing in you land on the "Confirm your email address" page and cannot go further.

**Cause:** The 6-digit code is valid for 15 minutes only, can be used once and is blocked after several wrong entries.

**Solution:** On the confirmation page click **Send again**. Check your spam folder too. Do not request codes too quickly: if the app says you can request a new code at a given time, wait until then. See [Sign up](help:getting-started/sign-up).

## Invitation invalid or expired

**Symptom:** "The invitation is invalid, expired or meant for another account." or "The invitation has expired."

**Cause:** Invitations are valid for 7 days and only for the invited, confirmed e-mail address. You may be signed in with another address, or the invitation was already answered or revoked.

**Solution:** Sign in with the invited address and confirm it. If it expired, ask an admin to re-send it ([Invitations](help:team/invitations)). If the app says the club reached its maximum number of members, an admin can remove members first.

## Consent required

**Symptom:** Instead of the calendar you see the "Consent required" page.

**Cause:** The privacy policy or terms of use changed and you have to accept the current version.

**Solution:** Read the documents, tick them and click **Accept and continue**. See [Consent](help:settings/consent). If you do not want to agree, you can sign out or delete your account.

## You were signed out

**Symptom:** Suddenly the sign-in page appears again.

**Cause:** The session ended (after 30 days at the latest), or you signed out everywhere or changed your password or e-mail address. For safety, all devices are then signed out.

**Solution:** Just sign in again. More under [Sessions](help:settings/sessions). Connected AI apps also lose access and must be connected again ([Manage access](help:ai-assistants/manage-access)).

## Limit reached

**Symptom:** "Limit reached: This club or calendar cannot hold more of this."

**Cause:** You hit an upper limit, for example for events, locations or open invitations.

**Solution:** Delete entries you no longer need or revoke old invitations. The values are listed under [Limits](help:support/limits).

## Import: events are marked "Invalid"

**Symptom:** In the import, events are marked **Invalid**, or it says an event of the file could not be read.

**Cause:** The event has details the calendar does not accept (for example a name that is too long), or neither a valid date nor a name.

**Solution:** Edit the event in the preview, or click **Deselect invalid events** and import the rest. At most 5,000 events fit in one import. See [Import](help:organize/import).

## Calendar or feed not found

**Symptom:** "Calendar not found", "Event not found" or "Feed not found".

**Cause:** The link is incomplete or outdated, the feed or event was deleted or never published, or all selected calendars are archived.

**Solution:** Ask the club for the current link. Admins check the feed under **Publish** ([Feeds](help:publishing/feeds)) and unarchive calendars if needed ([Calendars](help:settings/calendars)).

## Calendar does not load

**Symptom:** "The calendar did not load" or "The events could not be loaded".

**Cause:** The internet connection was interrupted.

**Solution:** Check your connection and click **Reload**. Your selection is kept.

## See also

- [Frequently asked questions](help:support/faq)
- [Limits](help:support/limits)
