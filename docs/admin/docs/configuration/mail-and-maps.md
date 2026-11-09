# Mail and maps

## Mail

The app sends mail for account security and invitations. Without working mail, people cannot finish signing up.

### Settings

| Variable | Meaning |
|---|---|
| `MAILER_DSN` | How to reach your mail server. |
| `MAILER_FROM` | The sender shown to recipients, for example `Club Calendar <noreply@example.org>`. |

Examples for `MAILER_DSN`:

```
# Encrypted connection (port 587, STARTTLS), the usual choice
MAILER_DSN=smtp://user:password@mail.example.org:587

# Implicit TLS (port 465)
MAILER_DSN=smtps://user:password@mail.example.org:465

# Local mail catcher, for testing only (no mail leaves the machine)
MAILER_DSN=smtp://localhost:1025
```

!!! warning "Special characters in passwords"
    If the user name or password contains characters like `@`, `:` or `/`, encode them in the DSN (for example `@` becomes `%40`).

The default `null://null` discards every mail. Always set a real server for a live installation, and use a sender address on a domain you control.

### Which mails are sent

- Confirmation code (6 digits) when someone signs up
- Password reset link
- Club invitations
- Confirmation of a new e-mail address
- Codes for deleting an account or adding a passkey
- Notices when a password or e-mail address is changed

All mails carry the links to your imprint, privacy policy and terms (see [Legal](../legal.md)).

### Test your setup

There is no separate test command. The simplest test is to sign up with an address you can read: the confirmation code mail should arrive within a minute. Alternatively, start "Forgot password" for an existing account. Check the spam folder as well.

If nothing arrives, check the app's log (see [Operations](../operations.md)) for mail errors and confirm that your server may connect to the mail server's port (many hosts block outgoing port 25).

### Make sure mail is delivered

Mail from a new sender is easily marked as spam. Set up these three DNS records for the sender domain:

- **SPF**: lists the servers allowed to send for your domain.
- **DKIM**: a signature your mail provider adds. Your provider tells you which record to publish.
- **DMARC**: tells receivers what to do with mail that fails the checks. Start with a lenient policy.

If you use a mail service or your hosting provider's SMTP server, follow their guide for these records. Use the sender address from your own domain, not a free webmail address.

## Maps

Maps and address search are optional and use [Mapbox](https://www.mapbox.com/).

### Settings

| Variable | Meaning |
|---|---|
| `MAPBOX_TOKEN` | Your Mapbox access token. Empty = maps are off. |

To get a token, create a Mapbox account and copy a **secret or public access token** from the account's token page.

### Without a token

The app works fine. Locations keep their address, but there are no maps and no address search or map position. The map features answer "not available".

### How map traffic flows

All map data goes through your server. Browsers never contact Mapbox directly, and no third-party host appears in the page. Signed-in users load map tiles, styles and fonts through the app; public pages (such as a published calendar) show a static map image created by the server. Your token stays on the server and is never sent to visitors.

Because of this, Mapbox's URL restriction for tokens does **not** help: Mapbox sees only your server. Instead:

- Create a **dedicated token** for this app.
- Give it only the read scopes for styles, tiles, fonts, static images and geocoding. Do not give it write or admin scopes.
- Set a usage alert or spending limit in your Mapbox account.

### Built-in limits

To protect your Mapbox bill, the app caps usage. Results are cached on the server (map images and tiles for 30 days, address search for one hour), but cache hits still count towards the per-user and per-IP limits.

| What | Limit |
|---|---|
| Map tiles per signed-in user | 1,800 per hour |
| Map tiles per IP address | 3,600 per hour |
| Map styles and fonts per user | 900 per hour |
| Map styles and fonts for the whole instance | 60,000 per day |
| Static map images for public pages, per IP address | 360 per hour |
| Address searches per user | 50 per hour |
| Address searches for the whole instance | 3,000 per day |
| Tile requests for the whole instance | 2,500 per day, 13,000 per week, 45,000 per month |
| Static map images for the whole instance | 2,500 per day, 13,000 per week, 45,000 per month |

Users who hit a limit see a "too many requests" message and can try again later. Behind a reverse proxy, set `SYMFONY_TRUSTED_PROXIES`, otherwise all visitors share one IP address and one set of IP limits (see [Security](../security.md)). Other limits are listed there too.

See also [Configuration](index.md) and the [full variable list](reference.md).
