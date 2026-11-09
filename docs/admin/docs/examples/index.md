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

For all other settings see the [configuration reference](../configuration/reference.md).
