# Cache and storage

Both topics are optional. The defaults (a cache in files, a local folder for storage) are right for a single server, and you can ignore this page unless you run several containers or want to use an object storage.

## Cache

The app keeps short-lived data in a cache: rate limit counters, open sessions of connected AI apps, map images and tiles, address search results, holiday source data and public keys of single sign-on providers. By default these are files in the cache folder (`CACHE_DIR`, `/data/cache` in the Docker image).

With `CACHE_DSN` you can keep them in Redis or Valkey instead:

| `CACHE_DSN` | Meaning |
|---|---|
| empty or `filesystem` | Files in `CACHE_DIR`. The default, right for one server. |
| `redis://host:6379` or `rediss://...` | Redis (`rediss` = encrypted connection). |
| `valkey://host:6379` or `valkeys://...` | Valkey, the Redis-compatible fork. |

Use a shared cache when several containers or servers must see the same rate limits, connected AI app sessions and cache entries. On a single server, keep the files. `CACHE_PREFIX` (default `club-calendar`) is put in front of every key, so several installations can share one Redis; give each its own prefix.

The Docker image contains the Redis PHP extension. Without Docker install `ext-redis` (see [Hosting without Docker](hosting-without-docker.md)).

What moves to Redis: the application cache, rate limit counters, AI app sessions, map images, map tiles, address search results and holiday source data. What always stays where it is: the compiled application cache (per container, in files), the state of the scheduler, the queue and the scheduler lock (all in the database, unless you set `LOCK_DSN`).

After changing `CACHE_DSN`, restart the app. The cache starts empty, which is harmless.

!!! note "After the update to this version"
    The file cache is empty once after the update. That only means some data is fetched again.

### Clearing the cache

The normal `cache:clear` after an update does **not** empty Redis. To empty the shared caches, run:

```bash
php bin/console cache:pool:clear cache.app map_images geocoder_responses mapbox_proxy holiday_sources holiday_refresh_attempts
```

(With Docker: `docker compose exec app php bin/console ...`.) Alternatively, delete the keys with your `CACHE_PREFIX` in Redis. Clearing also resets the rate limit counters.

### When Redis is down

If Redis or Valkey cannot be reached, the app keeps running and shows no error, but:

- **Rate limits are not enforced** until it is back (see [Protection mechanisms](security.md#rate-limits)).
- Sessions of connected AI apps are lost, and caches are empty, so map and holiday requests go to their sources again.

Limits that are counted in the database, such as guesses of MFA codes and wrong passwords in a sensitive confirmation, are not affected. Monitor your Redis and fall back to the file cache if you cannot keep it running.

### Other cache servers

Classic hosting stays on the file cache. Other adapters (for example Memcached, or a Redis cluster with special options) are not selectable by a setting. You would adapt the application's cache configuration yourself, which has to be redone when you update. Redis and Valkey cover most cases.

## Storage

The app has a file storage that is either a local folder or an S3-compatible bucket. Today it holds one file: the location database (only with `MAXMIND_LICENSE_KEY`, see below). It is prepared for further files in the future. Nothing here is needed for a normal installation; the default is fine for a single server.

| Variable | Meaning |
|---|---|
| `STORAGE_SOURCE` | `storage.local` (default) or `storage.s3`. |
| `STORAGE_LOCAL_PATH` | Folder for the local storage. Docker image: `/data/storage`. Without Docker: `backend/var/storage`. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_PREFIX`, `S3_USE_PATH_STYLE` | Where the bucket is. Leave `S3_ENDPOINT` empty for Amazon S3. |
| `S3_KEY`, `S3_SECRET` | Access key. Both empty = the default AWS credentials of the machine (for example a role). |
| `S3_SSE_C_KEY`, `S3_SSE_C_KEY_PREVIOUS` | Encryption key, see below. |

All variables are in the [reference](configuration/reference.md#cache-and-file-storage).

With Docker, keep `/data` (or at least `/data/storage`) on a volume when you use the local storage, as the example Compose file does. Some data stays local on purpose: the compiled cache, PDF fonts, logs, the login keys, the legal documents and the local copy of the location database.

Check the setup with:

```bash
php bin/console app:storage:check
```

It writes, reads and deletes a test file and prints the storage in use (source, host of the endpoint, bucket and whether the encryption is on). It never prints secrets.

### Location database

With `MAXMIND_LICENSE_KEY` set, the downloaded location database is kept in this storage. Each container makes a temporary local copy of it in its cache folder and replaces that copy by itself when a newer file is stored; clearing the cache just makes it fetch the copy again. If the storage cannot be reached, the last local copy keeps being used, and without any copy the location in notices stays empty. A broken download never replaces the stored file. Run `php bin/console app:geoip:update --force` to update it right away.

### Encrypting S3 files with your own key

For S3 you can let the storage service encrypt every file with a key that only you hold (SSE-C). This is set up with `S3_SSE_C_KEY`; it is ignored with the local storage.

1. Create a key: `openssl rand -base64 32`.
2. Set `S3_SSE_C_KEY` to that value and restart the app.

Things you must know:

- **The key must use `https`.** Amazon S3 and MinIO refuse SSE-C over plain `http`.
- **If you lose the key, the files are lost.** There is no recovery. Keep the key in your password manager and in your backups, apart from the bucket.
- The key is a secret like `APP_SECRET`: keep it out of version control.

#### Rotating the key

1. Create a new key.
2. Set the new key as `S3_SSE_C_KEY` and the old key (several, comma-separated, if you changed it before) as `S3_SSE_C_KEY_PREVIOUS`. Restart the app.
3. The container re-encrypts all files with the new key at start (`web` and `all` roles; a failure only logs a warning). To do it by hand and see the result, run `php bin/console app:storage:rotate-key`; `--dry-run` only counts. Files larger than 5 GiB are reported and not rotated. Only one container does the work at a time; the others skip it.
4. When it ends without errors, remove `S3_SSE_C_KEY_PREVIOUS`.

Keep the old key until step 3 has succeeded; without it the old files cannot be read.

#### Switching on encryption for an existing bucket

If the bucket already holds unencrypted files, set `S3_SSE_C_KEY` to the new key and `S3_SSE_C_KEY_PREVIOUS` to `plain`, then restart. The files are encrypted as in the rotation above. Remove `S3_SSE_C_KEY_PREVIOUS` afterwards.
