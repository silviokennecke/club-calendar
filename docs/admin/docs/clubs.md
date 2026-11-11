# Clubs and members

This page explains the club roles and the two club settings that decide how people join and how they subscribe to the calendar. Other limits are listed under [Protection mechanisms](security.md#quotas).

## Club roles

Every person in a club has one of four roles. Club admins assign them when they invite someone or change a member's role.

| Role | What it can do |
|---|---|
| Member | Belongs to the club and has its own "My club" page with a personal calendar and subscription. No access to the club's content otherwise; sees only the feeds shared with them. |
| Viewer | Reads the club's calendars, events and feeds. |
| Editor | Everything a viewer does, plus creates and changes events, series, templates, locations, audiences, badges, extras and holiday calendars. |
| Admin | Everything an editor does, plus manages calendars, members, invitations and the club settings. |

A club can have up to 5,000 members. At most 500 of them can hold a staff role (viewer, editor or admin); the others are plain members.

## Joining through feeds

Signed-in people can become members by opening a feed of the club. Club admins decide how this works in the club settings, under **Joining through feeds** (German: "Beitritt über Feeds"):

| Setting | Effect |
|---|---|
| Off | Nobody joins through a feed. Members come in through invitations only. |
| Club-internal feeds only (default) | Joining works through feeds set to "Club-internal" and through private feeds (the secret is needed). |
| Also through public feeds | As above, and through public feeds as well. |

Notes:

- Joining through a feed makes the person a **member** only. They get no access to the club's content.
- The setting only applies to new joins. Existing members and open invitations are not affected.
- Joining through a private feed also needs the feed's secret. Admins can give members access to a private feed by hand as well.

!!! warning "Joining through feeds and registration"
    With `RESTRICT_REGISTRATION=true`, an account can normally only be created with an open invitation. A feed that lets people join also lets them create an account, so with the default setting anyone who has the address of a "Club-internal" feed can register. If you want registration to stay invitation-only, set **Joining through feeds** to **Off** in every club. See [Registration control](security.md#registration-control).

## Personal subscription links

Every member has one personal calendar subscription per club. It shows the events of the feeds and audiences the member has chosen, and its address contains a personal secret. The address is never indexed by search engines.

- Members see their link under **My club**, tab **Subscription**. They can renew it there or in their profile.
- Renewing a link makes the old one stop working at once. The member must enter the new address in every calendar app.
- The subscription is removed when the member leaves the club or is removed from it. The link then stops working.

Nothing needs to be configured for this. Renewing a link is limited to 10 times per hour per user (see [Protection mechanisms](security.md#rate-limits)).
