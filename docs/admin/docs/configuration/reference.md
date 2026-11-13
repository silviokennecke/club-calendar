# Environment variable reference

All variables an admin can set. Variables marked **required** have no default. The Docker container will not start without `APP_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL` and `APP_URL`. See [How configuration works](index.md) for where to put them and the value formats. Durations are seconds.

## General and addresses

| Variable | Default | Description |
|---|---|---|
| `APP_URL` | **required** | Public address of the app, e.g. `https://calendar.example.com`. Used for all links in e-mails and redirects. |
| `APP_NAME` | `Club Calendar` | Name of your installation. Shown as page title and logo text, in e-mails (header, footer, subjects), as sender name of mails (Docker image, unless `MAILER_FROM` is set), in authenticator apps and as server name for connected AI apps. Surrounding spaces and control characters are removed, at most 60 characters; empty = default. Restart the app after changing it. |
| `APP_ENV` | `dev` (`prod` in the Docker image) | Use `prod` on a live server. |
| `FRONTEND_URL` | `APP_URL` | Address of the web app. Only for split setups. Passkeys work only on exactly this address. |
| `BACKEND_URL` | `APP_URL` | Public address of the API. Only for split setups. It is used in the link for confirming a new e-mail address and for SSO, so it must be reachable by users. |
| `TRUSTED_HOSTS` | empty | Extra host names the app accepts, comma-separated (e.g. a `www` alias). |
| `SYMFONY_TRUSTED_PROXIES` | empty | Addresses of reverse proxies in front of the app, comma-separated. Needed so rate limits see real visitor addresses. The visitor address and the country header of a proxy are trusted only from these addresses. |
| `PORT` | `8080` | Docker image only: port the built-in web server listens on. |
| `RUN_MIGRATIONS` | `1` | Docker image only: set `0` to skip database updates at start. |
| `MIGRATION_RETRIES` | `15` | Docker image only: how often the start waits (2 s apart) for the database before giving up. |
| `ROLE` | `all` | Docker image only: `all` (web server, workers and scheduler), `web` (web server only) or `worker` (workers and scheduler only). See [Operations](../operations.md#roles-in-the-docker-image). |
| `MESSENGER_WORKERS` | `2` | Docker image only: number of workers per container that send mail and run jobs, 1 to 32. |
| `SCHEDULER_ENABLED` | `true` | `false` stops this container (or process) from starting scheduled jobs. |
| `MIGRATION_WAIT_RETRIES` | `90` | Docker image, `ROLE=worker` only: how often (2 s apart) the container checks that the database changes are done before it gives up. |


## Database and queue

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | **required** | Connection to MySQL 8 or MariaDB, e.g. `mysql://user:password@host:3306/club_calendar`. The [example Compose file](../examples/index.md) builds it from `DB_NAME`, `DB_USER` and `DB_PASSWORD`. |
| `MESSENGER_TRANSPORT_DSN` | `doctrine://default?auto_setup=0` | Where the job and mail queue is kept. The default is your database; leave it unless you know why not. See [Operations](../operations.md#the-queue). |
| `LOCK_DSN` | empty | Lock that keeps the scheduler unique. Empty = your database. Only for several servers that prefer Redis, e.g. `redis://redis:6379`. |


## Security and sessions

JWT keys are created automatically. In Docker they live under `/data/config`, so keep `/data` on a volume. More in [Security](../security.md).

| Variable | Default | Description |
|---|---|---|
| `APP_SECRET` | **required** | Long random secret. Encrypts the stored feed and personal calendar secrets, signs short-lived tokens and (unless `JWT_PASSPHRASE` is set) unlocks the signing keys. Back it up together with the database. Do not change it casually: follow [Changing `APP_SECRET`](../operations.md#changing-app_secret). |
| `APP_SECRET_PREVIOUS` | empty | Only while changing `APP_SECRET`: the old value (several values separated by commas). Used to read secrets that are still encrypted with it; `app:secrets:rotate` re-encrypts them. Remove it afterwards. |
| `JWT_REFRESH_SECRET` | **required** | Long random secret (at least 32 characters) for session renewal tokens. Changing it signs everyone out. |
| `JWT_PRIVATE_KEY` | Docker image: `/data/config/private.pem`. Without Docker: `backend/config/jwt/private.pem` | Path to the signing key. Generated automatically at first start if missing. |
| `JWT_PUBLIC_KEY` | Docker image: `/data/config/public.pem`. Without Docker: `backend/config/jwt/public.pem` | Path to the matching public key. |
| `JWT_PASSPHRASE` | value of `APP_SECRET` | Passphrase of the private key. Set it explicitly to the old `APP_SECRET` before you change `APP_SECRET`. |
| `REFRESH_TOKEN_ABSOLUTE_LIFETIME` | `2592000` (30 days) | Longest a session lasts, however often it renews. |
| `REFRESH_TOKEN_REUSE_GRACE` | `10` | Seconds in which a renewal may be repeated (lost response, two tabs) without ending the session. |
| `OAUTH_LOGIN_CODE_TTL` | `180` | Seconds the one-time code after a single sign-on redirect stays valid. |


## Registration and sign-in

| Variable | Default | Description |
|---|---|---|
| `RESTRICT_REGISTRATION` | `false` | When `true`, only e-mail addresses with an open club invitation can create an account, or people who join a club through a feed that allows it (club setting "Joining through feeds"). Create the first user on the command line. |
| `RESTRICT_CLUB_CREATION` | `false` | When `true`, users cannot create clubs themselves; you create them on the command line (`app:club:create`). With `RESTRICT_REGISTRATION=true` as well, the first user may create the first club. Invitations are unaffected. |


## Single sign-on (SSO)

Leave empty to hide a provider. Setup: [Single sign-on](sso.md).

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | empty | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | empty | Google OAuth client secret. |
| `MICROSOFT_CLIENT_ID` | empty | Microsoft app (client) ID. |
| `MICROSOFT_CLIENT_SECRET` | empty | Microsoft client secret. |
| `MICROSOFT_TENANT_ID` | `common` | Microsoft tenant: `common`, `organizations`, `consumers` or a tenant ID. |
| `APPLE_CLIENT_ID` | empty | Apple Services ID. |
| `APPLE_CLIENT_SECRET` | empty | Apple client secret: a pre-generated token signed with your Apple private key (it expires, so renew it). |


## Security notices and location

City and country in security mails and the security log. See [Location in security notices](../security.md#location-in-security-notices).

| Variable | Default | Description |
|---|---|---|
| `MAXMIND_ACCOUNT_ID` | empty | Your MaxMind account ID. Needed with the licence key to download the database. |
| `MAXMIND_LICENSE_KEY` | empty | MaxMind licence key. When set, the local GeoLite2 City database is the only source of locations and the country header is ignored. Using the database means accepting MaxMind's licence terms. |
| `GEOIP_DB_PATH` | Docker image: `/data/geoip/GeoLite2-City.mmdb`. Without Docker: `backend/var/geoip/GeoLite2-City.mmdb` | Where the database file is stored. The folder must be writable and, with Docker, kept on a volume. |
| `CLIENT_COUNTRY_HEADER` | empty | Header in which your CDN or proxy sends the visitor's country code. Used only without a MaxMind key and only for requests from a trusted proxy (`SYMFONY_TRUSTED_PROXIES`). Empty = off. |


## Passkeys

| Variable | Default | Description |
|---|---|---|
| `WEBAUTHN_RP_NAME` | `APP_NAME` | Name shown by the browser when users create a passkey. Passkeys created earlier keep the name they had. |
| `WEBAUTHN_RP_ID` | host of `APP_URL` | Domain passkeys belong to. A passkey only works on the domain it was created for, so changing it makes existing passkeys unusable. |
| `WEBAUTHN_USER_VERIFICATION` | `preferred` | `preferred`, `required` (always PIN or biometrics) or `discouraged`. |


## Mail

See [Mail and maps](mail-and-maps.md).

| Variable | Default | Description |
|---|---|---|
| `MAILER_DSN` | `null://null` (mails are discarded) | Mail server connection, e.g. `smtp://user:pass@host:587`. Without it no mail is sent, so nobody can confirm an address. |
| `MAILER_FROM` | Docker image: `"<APP_NAME> <noreply@localhost>"` | Sender of all mails; when set, it replaces the whole default including the name. Use an address on a domain you control. |


## Maps

Optional. See [Mail and maps](mail-and-maps.md).

| Variable | Default | Description |
|---|---|---|
| `MAPBOX_TOKEN` | empty | Mapbox access token. Without it, maps and address search are off. |
| `MAP_IMAGE_CACHE_TTL` | `2592000` (30 days) | How long static map images are cached. |
| `MAPBOX_PROXY_CACHE_TTL` | `2592000` (30 days) | How long map tiles and styles are cached. |
| `GEOCODER_CACHE_TTL` | `3600` | How long address search results are cached. |


## Public feeds

Calendar feeds that people subscribe to.

| Variable | Default | Description |
|---|---|---|
| `FEED_ICS_WINDOW_ENABLED` | `true` | Limit the subscription file to a time window. `false` delivers the whole history. |
| `FEED_ICS_PAST_DAYS` | `180` | Days into the past included. |
| `FEED_ICS_FUTURE_MONTHS` | `24` | Months into the future included. |
| `FEED_ICS_MAX_EVENTS` | `0` | Maximum events per subscription file (earliest first). `0` = unlimited. |
| `FEED_RATE_LIMIT_PER_IP` | `120` | Feed requests per minute per visitor. `0` = off. |
| `FEED_RATE_LIMIT_PER_FEED` | `600` | Feed requests per minute per feed. `0` = off. |


## Rate limits

Per-visitor limits for the sign-in endpoints (per 15 minutes unless noted). Leave the defaults unless a shared address (school, company network) hits them. The feed limits are listed under Public feeds above; all limits are described in [Security](../security.md).

| Variable | Default | Description |
|---|---|---|
| `AUTH_LOGIN_IP_LIMIT` | `10` | Password sign-in attempts per visitor address. |
| `AUTH_REGISTER_IP_LIMIT` | `5` | Sign-ups per visitor address (per hour). |
| `AUTH_REFRESH_IP_LIMIT` | `60` | Session renewals per visitor address (per minute). |
| `AUTH_IDENTIFY_IP_LIMIT` | `30` | E-mail checks on the first sign-in step, per visitor address. |
| `AUTH_IDENTIFY_EMAIL_LIMIT` | `10` | E-mail checks per e-mail address. |


## MCP / AI apps

Lets AI assistants read the calendar and draft events after the user approves. See [Security](../security.md).

| Variable | Default | Description |
|---|---|---|
| `MCP_ALLOWED_CLIENTS` | `claude,openai,gemini` | Which AI apps may connect, comma-separated. `*` allows every app (shown to users as unverified); empty allows none. |
| `MCP_ACCESS_TOKEN_TTL` | `3600` | Seconds an access lasts before it is renewed. |
| `MCP_REFRESH_TOKEN_LIFETIME` | `604800` (7 days) | Seconds a connection stays alive without use. |
| `MCP_REFRESH_TOKEN_ABSOLUTE_LIFETIME` | `2592000` (30 days) | Longest a connection lasts before the user must approve again. |
| `MCP_REFRESH_TOKEN_REUSE_GRACE` | `10` | Seconds in which a renewal may be repeated without revoking the connection. |


## Legal texts

Imprint, privacy policy and terms. See [Legal](../legal.md).

| Variable | Default | Description |
|---|---|---|
| `LEGAL_DOCUMENTS_PATH` | Docker image: `/data/legal`. Without Docker: `backend/legal/` | Folder with `imprint.md`, `privacy.md`, `terms.md`. |
| `LEGAL_IMPRINT_URL` | empty | Link to an externally hosted imprint. Used only when `imprint.md` is missing. |
| `LEGAL_PRIVACY_URL` | empty | Same for the privacy policy. |
| `LEGAL_TERMS_URL` | empty | Same for the terms of use. |


## Cache and file storage

See [Cache and storage](../cache-and-storage.md).

| Variable | Default | Description |
|---|---|---|
| `CACHE_DIR` | Docker image: `/data/cache`. Without Docker: inside `backend/var/` | Where cached data (including rate limit counters) is stored with the file cache. Must be writable. |
| `CACHE_DSN` | empty (files in `CACHE_DIR`) | `redis://`, `rediss://`, `valkey://` or `valkeys://` address to share the cache between servers. Empty or `filesystem` = files. |
| `CACHE_PREFIX` | `club-calendar` | Name prefix of all cache keys. Set a different one per installation when several share one Redis. |
| `STORAGE_SOURCE` | `storage.local` | Where app files are kept: `storage.local` (a folder) or `storage.s3` (an S3-compatible bucket). |
| `STORAGE_LOCAL_PATH` | Docker image: `/data/storage`. Without Docker: `backend/var/storage` | Folder for the local storage. Must be writable. |
| `S3_ENDPOINT` | empty | Address of the S3 service. Empty = Amazon S3. Set it for MinIO, Hetzner, Scaleway and similar. |
| `S3_REGION` | `us-east-1` | Region of the bucket. |
| `S3_KEY` | empty | Access key. Together with `S3_SECRET`; both empty = the default AWS credentials of the server or task. |
| `S3_SECRET` | empty | Secret of the access key. |
| `S3_BUCKET` | empty | Name of the bucket. |
| `S3_PREFIX` | empty | Optional folder inside the bucket. |
| `S3_USE_PATH_STYLE` | `false` | `true` for providers that need path-style addresses (often MinIO). |
| `S3_SSE_C_KEY` | empty | Customer key that encrypts the files in the bucket: base64 of 32 random bytes. Losing it loses the files. Needs `https`. |
| `S3_SSE_C_KEY_PREVIOUS` | empty | Only while changing the key: older keys, comma-separated; `plain` = unencrypted files may still exist. |

The `S3_*` variables apply only with `STORAGE_SOURCE=storage.s3`.


The variables for tests (such as `TEST_DATABASE_URL`) are for developers only and are not listed.
