# Metrics and logs (OpenTelemetry)

The app can send usage numbers (metrics) and, optionally, log messages to a monitoring system that speaks OpenTelemetry (OTLP). You can then watch, for example, how many clubs and events exist, how many people sign in, and how often calendar apps fetch your feeds.

It is **off by default**. Nothing is sent, and the feature costs nothing, until you set an OTLP address (`OTEL_EXPORTER_OTLP_ENDPOINT`). You need your own receiver, such as an OpenTelemetry Collector, Grafana Cloud or another OTLP-capable service. The [Grafana example](#example-grafana-with-opentelemetry) below shows a complete setup.

## Turn it on

1. Run a receiver that accepts **OTLP over HTTP** (protobuf). gRPC is not supported.
2. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to its base address, for example `http://otel-collector:4318`. The app adds `/v1/metrics` and `/v1/logs` itself.
3. Restart the containers.

| Variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | empty (off) | Base address of the receiver. Empty = the feature is off. |
| `OTEL_SDK_DISABLED` | `false` | `true` switches everything off even when an address is set. |
| `OTEL_SERVICE_NAME` | `club-calendar` | Name of this installation in your monitoring system. Change it when several installations send to the same place. |
| `OTEL_RESOURCE_ATTRIBUTES` | empty | Extra labels for everything that is sent, as `key=value` pairs separated by commas, for example `deployment.environment=production`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | empty | Extra HTTP headers for authentication, as `key=value` pairs separated by commas. Write spaces as `%20`, for example `Authorization=Bearer%20your-token`. |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | `1000` | Milliseconds the app waits for the receiver before it gives up. Keep it short. |
| `OTEL_EXPORTER_OTLP_COMPRESSION` | `none` | `gzip` compresses what is sent. |
| `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` | `delta` | How counters are reported, see [Delta counters](#delta-counters). |
| `OTEL_LOGS_EXPORTER` | `otlp` | `none` sends metrics only. Logs follow the same address and on/off switch as metrics. |
| `OTEL_LOGS_LEVEL` | `warning` | Lowest log level that is sent: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert` or `emergency`. A lower level means more data. |

Other `OTEL_*` variables (for example an export interval) are not supported.

!!! warning "Set the variables on every container"
    The web container and the worker container need the **same** `OTEL_*` variables. The worker sends the scheduled numbers and its own logs; without the variables there, those are missing. Set them as real container environment variables (`environment:` or `env_file:` in Compose), not only in a file inside the container. With `ROLE=all` one container does both. Without Docker, set them for PHP-FPM and for the worker and scheduler services (see [Hosting without Docker](hosting-without-docker.md#background-jobs-and-the-worker)).

### How sending works

- Sending happens **after** the response was delivered to the visitor, and in the worker after each job (and every 15 seconds while it is idle). Users never wait for it.
- An unreachable, slow or failing receiver causes no error for users. The app waits at most `OTEL_EXPORTER_OTLP_TIMEOUT` and then skips that transfer; a worker is busy that long at most. A warning may appear in the app log.
- **Data of a failed transfer is lost.** Nothing is stored and sent later. For the live counters that means the events of that request or batch are missing; the hourly and daily numbers are simply sent again at their next run.

### Delta counters

The live counters (sign-ins, feed requests, AI app calls) are sent as **deltas**: each transfer carries only the events since the last one. This suits an app that handles every request in a short-lived process and cannot keep running totals. Prometheus-style storage needs running totals, so put an OpenTelemetry Collector with the `deltatocumulative` processor between the app and the store (the example below does). Backends that understand deltas directly can receive them as they are. If your receiver insists on totals, `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` is accepted, but the numbers then restart with each process and are not useful.

## What is measured

Metric names below are as the app sends them. Prometheus-compatible stores rename them: dots become underscores and counters get the ending `_total`, for example `club_calendar.logins` becomes `club_calendar_logins_total`. Values such as `true` and `false` appear as the text `"true"` and `"false"`.

### Hourly numbers

Updated by the scheduled task `telemetry-hourly` at minute 5 of every hour (UTC). They are totals at that moment.

| Metric | Labels | Meaning |
|---|---|---|
| `club_calendar.users` | `verified`: `true`, `false` | Registered users, with and without a confirmed address |
| `club_calendar.clubs` | none | Clubs |
| `club_calendar.calendars` | `archived`: `true`, `false` | Calendars |
| `club_calendar.events` | `draft`: `true`, `false` | Events |
| `club_calendar.feeds` | `visibility`: `public`, `club`, `private` | Feeds |
| `club_calendar.member_subscriptions` | none | Personal subscriptions ("My subscription") |
| `club_calendar.mcp.grants` | none | Connected AI apps that are not revoked |
| `club_calendar.mcp.clients` | none | Registered AI app clients |
| `club_calendar.memberships` | `role`: `member`, `viewer`, `editor`, `admin` | Club memberships per role |

### Daily distributions

Updated by the scheduled task `telemetry-daily` at 03:20 UTC. Each metric describes one number per club, calendar or feed, summarised with the label `stat`: `avg`, `min`, `max`, `median` or `stddev` (population standard deviation). Nothing is sent for a kind that does not exist yet (for example no clubs).

| Metric | Other labels | Meaning |
|---|---|---|
| `club_calendar.club.members` | `role`: `member`, `viewer`, `editor`, `admin`, `all` | Members per club |
| `club_calendar.club.calendars` | none | Calendars per club (archived ones not counted) |
| `club_calendar.calendar.events` | none | Events per calendar |
| `club_calendar.club.feeds` | none | Feeds per club |
| `club_calendar.feed.calendars` | none | Calendars per feed |

### Live counters

Counted as they happen. They are the only numbers that depend on traffic.

| Metric | Labels | Meaning |
|---|---|---|
| `club_calendar.logins` | `method`: `password`, `passkey`, `sso`, `totp`, `backup_code`; `stage`: `primary`, `mfa`; `success`: `true`, `false`; `provider`: `google`, `microsoft`, `apple` or `none` (only with `method=sso`) | Sign-ins and failed sign-in attempts |
| `club_calendar.feed.requests` | `visibility`: `public`, `club`, `private`, `my_subscription`; `kind`: `ics` (subscription file), `web` (feed page data), `event`, `event_ics` (single event download); `status`: `200`, `304` | Feed requests that were answered |
| `club_calendar.mcp.calls` | `tool`: tool name; `access`: `read`, `write`, `unknown`; `outcome`: `ok`, `error` | Calls of AI app tools |

Things to know when reading the numbers:

- **Feed requests** are mostly calendar apps that fetch the subscription on a timer, not people. Status `304` means "unchanged since last time". Requests for unknown feeds, wrong secrets or rate-limited requests are not counted.
- **Sign-ins** count every attempt whose password, passkey or code was checked, successful or not. Attempts stopped by a rate limit are not counted. With MFA on, one sign-in is counted twice: once at the password or passkey step (`primary`) and once at the second step (`mfa`).
- The hourly and daily numbers need the **scheduler and a worker** to run, see [Scheduled tasks](operations.md#scheduled-tasks-and-the-worker). Without them these metrics stay empty or stale.

## Privacy

- Metrics carry **only counts**. They have no label with a user, e-mail address, club, calendar, feed, IP address or secret.
- **Logs are sensitive.** When logs are sent, log messages, error texts and the file paths in stack traces leave your server. Tokens in addresses and similar secrets are masked, but only on a best-effort basis (see [Logs and health](operations.md#logs-and-health)). Send logs only to a system you control and secure, and mention it in your privacy policy if personal data can end up there.
- To send metrics only, set `OTEL_LOGS_EXPORTER=none`. To reduce the volume of logs, raise `OTEL_LOGS_LEVEL` (for example to `error`).
- Everything travels as plain HTTP unless you use an `https://` address. Use `https://` or a private network whenever the receiver is not on the same host.

## Example: Grafana with OpenTelemetry

!!! note "Advanced example"
    This example is for administrators who already run monitoring tools. It is **not a hardened production setup**: the parts talk to each other without TLS and without authentication, and Grafana starts with a password from your `.env`. For production add TLS and authentication to every connection, keep the stack off the public internet and back up the data volumes.

The stack runs next to the app in Docker Compose:

- an **OpenTelemetry Collector** receives the data and converts the delta counters into running totals,
- **Prometheus** stores the metrics,
- **Loki** stores the logs,
- **Grafana** shows both. The ready-made dashboard "Club Calendar – Instance" is loaded automatically.

### Files

Download the files into the folder that holds your `docker-compose.yml`. Details: [Examples](examples/index.md#telemetry-stack).

```bash
BASE=https://silviokennecke.github.io/club-calendar/examples
for f in docker-compose.telemetry.yml otel-collector.yaml grafana-datasources.yml grafana-dashboards.yml grafana-dashboard.json; do curl -fLO $BASE/$f; done
```

### Start

1. Optionally set `GRAFANA_ADMIN_PASSWORD` in your `.env` (default: `change-me`).
2. Start everything: `docker compose -f docker-compose.yml -f docker-compose.telemetry.yml up -d`. The extra file sets the `OTEL_*` variables of the `app` service. If you run a separate worker container, give it the same variables.
3. Open Grafana at `http://localhost:3000` (it listens on this machine only; use an SSH tunnel or your TLS proxy to reach it from elsewhere). Sign in as `admin`.
4. The dashboard appears under Dashboards. Hourly numbers show after the first full hour, the daily ones after 03:20 UTC; sign-ins and feed requests show as they happen. Logs are in Explore with the Loki datasource.

The dashboard expects a Prometheus-compatible datasource. The example sets Prometheus as the default datasource, so the dashboard picks it without further steps.

### Import the dashboard by hand

If you use your own Grafana: **Dashboards, New, Import**, upload `grafana-dashboard.json` and choose your Prometheus-compatible datasource when asked. Your store must receive the metrics under the Prometheus names described above, which means a collector with `deltatocumulative` in front of it.

### Grafana Cloud

Grafana Cloud accepts OTLP directly. In the Cloud portal open your stack's **OpenTelemetry** details to get the OTLP address (`https://otlp-gateway-<zone>.grafana.net/otlp`), the instance ID and an access token. The simplest dependable way is to keep the collector from the example and replace its two exporters by one `otlphttp` exporter that points at that address and sends the credentials with basic authentication (instance ID as user name, token as password), instead of running Prometheus and Loki yourself. Keep the `deltatocumulative` processor in the metrics pipeline. We could not verify whether Grafana Cloud accepts delta counters without it, so check the current Grafana Cloud documentation before sending deltas directly from the app. Then import the dashboard as described above.

## Troubleshooting

- **No data at all.** Check that `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the container (`docker compose exec app printenv | grep OTEL`) and that `OTEL_SDK_DISABLED` is not `true`. The address must be reachable **from inside the container**, so `localhost` is usually wrong; use the service name.
- **Receiver reachable but nothing arrives.** Look at the receiver's own log. Wrong headers or tokens show up there as 401 or 403. Check the address: it is the base address without `/v1/metrics`.
- **Counters work but the hourly numbers are missing.** The scheduler or worker is not running, or it has no `OTEL_*` variables. Check with `docker compose logs worker` (or `app`).
- **Some data is missing now and then.** A transfer timed out and was dropped. Raise `OTEL_EXPORTER_OTLP_TIMEOUT` a little if the receiver is slow, but keep it small.
- **Metric names look different.** Prometheus-compatible stores replace dots by underscores and add `_total` to counters.
- **Counters flat or odd in Prometheus.** The collector must convert deltas to totals (`deltatocumulative`). Series that receive nothing for the configured time are dropped and start again from zero.
