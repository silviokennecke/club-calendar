# Example files

Three files for a standard installation with Docker Compose. Download them into one empty directory. Step by step: [Quick start](../quick-start.md).

| File | Purpose |
|---|---|
| [docker-compose.yml](docker-compose.yml) | The app and its MySQL database |
| [docker-compose.override.yml](docker-compose.override.yml) | Optional: Caddy proxy with automatic HTTPS. Compose picks it up automatically. Skip it if you already run a reverse proxy |
| [example.env](example.env) | Settings. Save it as `.env` and edit it |

```bash
BASE=https://silviokennecke.github.io/club-calendar/examples
curl -fLO $BASE/docker-compose.yml
curl -fLO $BASE/docker-compose.override.yml
curl -fL $BASE/example.env -o .env
```

!!! note "Hidden file"
    `.env` starts with a dot, so file managers and `ls` may hide it. Use `ls -a`.

=== "docker-compose.yml"

    ```yaml title="docker-compose.yml"
    --8<-- "docker-compose.yml"
    ```

=== "docker-compose.override.yml"

    ```yaml title="docker-compose.override.yml"
    --8<-- "docker-compose.override.yml"
    ```

=== "example.env"

    ```bash title=".env"
    --8<-- "example.env"
    ```

## Telemetry stack

Optional files for [metrics and logs with Grafana](../telemetry.md#example-grafana-with-opentelemetry). Advanced example, not a hardened production setup. Put them next to `docker-compose.yml` and start with `docker compose -f docker-compose.yml -f docker-compose.telemetry.yml up -d`.

| File | Purpose |
|---|---|
| [docker-compose.telemetry.yml](docker-compose.telemetry.yml) | Collector, Prometheus, Loki and Grafana; sets the `OTEL_*` variables of the app |
| [otel-collector.yaml](otel-collector.yaml) | Collector settings |
| [grafana-datasources.yml](grafana-datasources.yml) | Grafana datasources (Prometheus, Loki) |
| [grafana-dashboards.yml](grafana-dashboards.yml) | Loads the dashboard file |
| [grafana-dashboard.json](grafana-dashboard.json) | The dashboard "Club Calendar – Instance" (also for manual import) |

=== "docker-compose.telemetry.yml"

    ```yaml title="docker-compose.telemetry.yml"
    --8<-- "docker-compose.telemetry.yml"
    ```

=== "otel-collector.yaml"

    ```yaml title="otel-collector.yaml"
    --8<-- "otel-collector.yaml"
    ```

=== "grafana-datasources.yml"

    ```yaml title="grafana-datasources.yml"
    --8<-- "grafana-datasources.yml"
    ```

=== "grafana-dashboards.yml"

    ```yaml title="grafana-dashboards.yml"
    --8<-- "grafana-dashboards.yml"
    ```

For all other settings see the [configuration reference](../configuration/reference.md).
