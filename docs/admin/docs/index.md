# Overview

Club Calendar is a web app for clubs to manage and publish their event calendars. Members plan events, series and
templates, keep holidays in view, export to PDF and ICS, and share calendars as public or private feeds that others
can subscribe to. This guide is for the people who **install and run** the app. Everyday use is explained in the
app's own help pages (`/help`).

## How it is put together

```text
Browser / calendar apps
        |  HTTPS
Your reverse proxy (TLS)
        |  HTTP :8080
Club Calendar (web server + PHP) ---- MySQL 8 / MariaDB
        :
        +-- optional: mail server, Mapbox, SSO providers, holiday data
```

- **One application.** A web server and PHP serve the web app and its API from the same address. In the Docker
  image both run inside a single container.
- **One database.** MySQL 8 or MariaDB stores everything.
- **Optional services.** A mail server (confirmation codes, invitations, notices), Mapbox (maps), Google, Microsoft
  or Apple for single sign-on. See [Mail and maps](configuration/mail-and-maps.md) and
  [Single sign-on](configuration/sso.md).
- **HTTPS.** The container speaks plain HTTP on port 8080. Put a reverse proxy or load balancer in front that ends
  TLS.

!!! note "Outgoing connections"
    The server needs outgoing HTTPS to fetch holiday data (`openholidaysapi.org`) and, if you use SSO, to reach the
    providers' public keys (`www.googleapis.com`, `login.microsoftonline.com`, `appleid.apple.com`).

## System requirements

| What | Requirement |
|---|---|
| Docker (recommended) | Docker with Compose, access to `ghcr.io` |
| Without Docker | PHP 8.4, Apache or nginx, Node.js 22 (build only), see [Hosting without Docker](hosting-without-docker.md) |
| Database | MySQL 8 or MariaDB |
| Public address | A domain name with HTTPS |
| Memory | A small server is enough for a club. PDF export and large imports briefly need more memory, so leave some room |
| Mail (recommended) | An SMTP account. Without it, no confirmation codes or invitations can be sent |

## How this guide is organised

| Page | What you find there |
|---|---|
| [Quick start](quick-start.md) | Run Club Calendar with Docker Compose |
| [Hosting without Docker](hosting-without-docker.md) | Install on Apache or nginx with PHP |
| [How configuration works](configuration/index.md) | Where settings live and how to change them |
| [Reference](configuration/reference.md) | Every setting with its default |
| [Single sign-on](configuration/sso.md) | Sign-in with Google, Microsoft or Apple |
| [Mail and maps](configuration/mail-and-maps.md) | Outgoing mail and Mapbox |
| [Protection mechanisms](security.md) | Built-in security and what you must do |
| [Legal documents](legal.md) | Imprint, privacy policy and terms |
| [Operations](operations.md) | Updates, backups, scheduled tasks, tools, troubleshooting |
| [Examples](examples/index.md) | Ready-to-copy configuration files |

## Getting help

Questions, bug reports and security-relevant findings go to the project on GitHub:
[github.com/silviokennecke/club-calendar](https://github.com/silviokennecke/club-calendar). Release notes are in
`CHANGELOG.md` there and on the GitHub releases page.
