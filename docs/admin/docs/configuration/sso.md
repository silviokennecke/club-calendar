# Single sign-on

With single sign-on (SSO), people sign in with an account they already have at Google, Microsoft or Apple instead of a password. Each provider is optional. You can enable one, two or all three.

## What users get

- A "Continue with ..." button on the sign-in and sign-up pages.
- No new password to remember.
- Signed-in users can link or unlink providers in their profile. The last remaining sign-in method cannot be removed.

A button only appears when **both** the client ID and the client secret of that provider are set. If a provider is not configured, nobody sees its button. After changing the settings, apply them as described in [How configuration works](index.md).

## What you need first

- `APP_URL` must be your public HTTPS address. Providers reject plain HTTP (except for `localhost`).
- Your server must be able to reach the providers over HTTPS to check sign-ins: `accounts.google.com` and `www.googleapis.com` (Google), `login.microsoftonline.com` (Microsoft), `appleid.apple.com` (Apple).

## Requirements for the sign-in check

- Your server fetches the providers' public signing keys to check each sign-in and keeps them for one hour. If a provider is unreachable and its keys are not cached, SSO fails with `oauth_failed`.
- SSO needs HTTPS: the sign-in cookie is only sent over secure connections. For local tests use Chrome or Firefox; Safari is unreliable on `localhost`.

## The redirect address

Every provider asks for a redirect address (also called callback or return URL). It has the same shape for all three:

```
https://calendar.example.org/api/auth/oauth/<provider>/callback
```

Replace the host with your own address and `<provider>` with `google`, `microsoft` or `apple`. Register it exactly, with no trailing slash. The same address is used for signing in and for linking a provider in the profile, so you only register one.

!!! note "Split setups"
    If the app and the API run on different addresses, use the API address (`BACKEND_URL`) in the redirect address.

## Set up a provider

=== "Google"

    1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick an existing one).
    2. Go to **APIs & Services** > **OAuth consent screen**. Choose **External**, enter the app name and your support address, and save. Publish the app, otherwise only listed test users can sign in.
    3. Go to **Credentials** > **Create credentials** > **OAuth client ID**.
    4. Choose application type **Web application**.
    5. Under **Authorized redirect URIs** add `https://calendar.example.org/api/auth/oauth/google/callback`.
    6. Copy the client ID and the client secret.

    Set these variables:

    ```
    GOOGLE_CLIENT_ID=...
    GOOGLE_CLIENT_SECRET=...
    ```

    The app asks only for the basic scopes `openid`, `email` and `profile`.

=== "Microsoft"

    1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) and go to **App registrations** > **New registration**.
    2. Enter a name. Under **Supported account types** choose the option that fits your users. For a public club, pick accounts in any organizational directory and personal Microsoft accounts.
    3. Under **Redirect URI** choose platform **Web** and enter `https://calendar.example.org/api/auth/oauth/microsoft/callback`.
    4. After saving, copy the **Application (client) ID**.
    5. Go to **Certificates & secrets** > **New client secret** and copy the secret **value** right away (it is shown only once).

    Set these variables:

    ```
    MICROSOFT_CLIENT_ID=...
    MICROSOFT_CLIENT_SECRET=...
    MICROSOFT_TENANT_ID=common
    ```

    `MICROSOFT_TENANT_ID` decides who may sign in. The default `common` allows work, school and personal accounts. Use `organizations` for work and school accounts only, `consumers` for personal accounts only, or the directory ID of a single organization to allow only its members. It must match the account types you chose in step 2.

    !!! warning "Secrets expire"
        Microsoft client secrets have an expiry date (at most 24 months). Note it in your calendar. When it passes, Microsoft sign-in stops working until you create a new secret and update `MICROSOFT_CLIENT_SECRET`.

=== "Apple"

    Apple needs an Apple Developer Program membership (paid). The setup is more involved than the other two.

    1. In the [Apple Developer account](https://developer.apple.com/account/), go to **Certificates, Identifiers & Profiles** > **Identifiers**.
    2. Create an **App ID** with the capability **Sign in with Apple** enabled.
    3. Create a **Services ID**. Its identifier (for example `org.example.calendar.web`) is your client ID. Enable **Sign in with Apple** for it and click **Configure**.
    4. Choose the App ID as primary. Under **Domains and Subdomains** enter your domain (without `https://`). Under **Return URLs** enter `https://calendar.example.org/api/auth/oauth/apple/callback`.
    5. Go to **Keys** and create a key with **Sign in with Apple** enabled. Download the `.p8` private key file (one download only) and note the **Key ID**. Also note your **Team ID** (top right of the account page).
    6. Create the client secret. Apple does not give you a ready-made secret. It is a signed token (JWT) that you generate yourself from the `.p8` key, the Key ID, the Team ID and the Services ID. The app does not create it for you.

    Set these variables:

    ```
    APPLE_CLIENT_ID=org.example.calendar.web
    APPLE_CLIENT_SECRET=<the generated token>
    ```

    The app asks for the scopes `openid`, `email` and `name`.

    !!! warning "The Apple secret expires"
        Apple accepts a client secret token for at most six months. Generate a new one before it expires and update `APPLE_CLIENT_SECRET`. Otherwise Apple sign-in stops working. Keep the `.p8` file safe: you need it for every renewal.

## E-mail confirmation

Google and Apple tell the app whether a person's address is verified, so those users are signed in directly.

Microsoft does not prove the address in a way the app can trust. People who register with Microsoft get a 6-digit code by e-mail and must enter it before they can use the app. This is normal and no action is needed, but your mail setup must work (see [Mail and maps](mail-and-maps.md)).

## Closed registration

With `RESTRICT_REGISTRATION=true`, a **new** account can only be created for an address that has an open club invitation. This applies to SSO too. Existing accounts can still sign in, and linking a provider in the profile still works. Someone without an invitation sees "registration restricted" (see below).

## Troubleshooting

When SSO fails, the user lands on the sign-in page with a message. If they report a code, this table tells you what to do.

| Code | What it means | What to do |
|---|---|---|
| `invalid_request` | The sign-in was started in a way the app does not accept (for example by an old tab). | Ask the user to start again from the sign-in page. |
| `invalid_state` | The sign-in took longer than 10 minutes, was opened in another browser or tab, or the browser blocked the cookie. | Start again in the same browser tab. Check that the site runs on HTTPS and cookies are not blocked. |
| `provider_denied` | The user cancelled at the provider. | Nothing to fix. They can try again. |
| `provider_error` | The provider reported a problem. | Check the redirect address and the client ID in the provider console. Try again later. |
| `oauth_failed` | The provider's answer could not be checked or exchanged. | Check client ID and secret (expired or mistyped?), the redirect address, the Microsoft tenant, and that your server can reach the provider hosts. Then look at the error log. |
| `email_missing` | The provider did not share an e-mail address. | Ask the user to allow sharing the address, or to sign up with e-mail instead. |
| `account_exists` | An account with this address already exists and the provider does not prove the address (for example Microsoft), so it is not linked automatically. | Ask the user to sign in the usual way and link the provider in the profile. |
| `email_unverified_at_provider` | The provider says the address is not verified, so the existing account is not linked. | The user verifies the address at the provider, or signs in the usual way. |
| `registration_restricted` | Registration is closed and no open invitation exists for this address. | Invite the person to a club, then ask them to try again. |

Users who register through Microsoft must confirm their address by code (see above), so check that mail arrives if they report that nothing works after signing in. A user who has linked a provider and still cannot sign in can also use a password, a passkey or "Forgot password".

See also [Configuration](index.md) and the [full variable list](reference.md).
