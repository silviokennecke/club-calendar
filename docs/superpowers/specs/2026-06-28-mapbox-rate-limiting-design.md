# Mapbox Rate Limiting & Caching Design

**Date:** 2026-06-28  
**Status:** Approved

## Overview

Add rate limiting and caching to the three Mapbox API touch points in the backend: the geocoder, the static map image provider, and the general Mapbox proxy. The goal is to stay within Mapbox API quotas while keeping the implementation testable and the controllers thin.

## Constraints

- Rate limits apply only to **actual outbound Mapbox API calls** — cache hits do not consume quota.
- Storage: filesystem-backed (consistent with existing `map_images` pool; no Redis in the stack).
- Package required: `symfony/rate-limiter` (not yet installed).

---

## Architecture

Three service decorator chains. Each chain is structured so the **outermost layer is caching**: cache hits short-circuit before reaching the rate limiter or the API.

```
MapController.suggest / reverse
    └── CachingGeocoderDecorator          (geocoder_responses pool, 1 h)
            └── RateLimitedGeocoderDecorator   (3000/day system + 50/h per user)
                    └── BazingaGeocoderAdapter  (Mapbox Geocoder API)

MapController.buildImageResponse
    └── CachingMapImageProvider           (map_images pool, 30 days)
            └── RateLimitedMapImageProvider    (2500/day + 13000/week + 45000/month system)
                    └── MapboxMapImageProvider  (Mapbox Static Images API)

MapboxController.proxy
    └── MapboxProxyService
            ├── pattern whitelist + method check  → 403 if denied
            ├── mapbox_proxy cache pool (30 days, GET only)
            └── rate limit check if pattern.rate_limited → 429 if exhausted
                    └── upstream HttpClient call
```

Controllers stay thin: parse request, call outermost service, build `Response`.

---

## Cache Key Helper

`App\Service\Map\MapCacheKeyHelper` — a class with named static methods used by every decorator and the cache invalidator. Centralises the hashing so key format changes happen in one place.

```php
MapCacheKeyHelper::forGeocoderSuggest(string $query, ?float $lat, ?float $lng, int $limit): string
MapCacheKeyHelper::forGeocoderReverse(float $lng, float $lat): string
MapCacheKeyHelper::forMapImage(float $lng, float $lat, int $zoom, int $width, int $height): string
MapCacheKeyHelper::forProxyRequest(string $method, string $path, array $queryParams): string
// queryParams must NOT include 'access_token' — the token is a system constant, not a cache discriminator
```

All methods return `sha256` of a stable string representation of their arguments.

---

## Geocoder Decorator Chain

### CachingGeocoderDecorator

- Implements `GeocoderInterface`.
- Injected with `CacheInterface $geocoderResponsesCache` (pool: `geocoder_responses`, 1-hour filesystem adapter).
- `suggest()` key: `MapCacheKeyHelper::forGeocoderSuggest(...)` — shared across users (same query → same result).
- `reverse()` key: `MapCacheKeyHelper::forGeocoderReverse(...)`.
- On cache hit: returns cached value without calling the inner decorator.

### RateLimitedGeocoderDecorator

- Implements `GeocoderInterface`.
- Injected with:
  - `RateLimiterFactory $geocoderDailyLimiter` — fixed window, 3000 requests / 24 h, key `"geocoder-system"`.
  - `RateLimiterFactory $geocoderHourlyLimiter` — fixed window, 50 requests / 1 h, keyed to the current user's UUID.
  - `RequestUserContext $userContext` — thin service that calls `Security::getUser()->getUserIdentifier()`.
- Before delegating to inner service: consumes 1 token from both limiters. If either is exhausted, throws `RateLimitExceededException`.
- `MapController` catches `RateLimitExceededException` and returns `429 Too Many Requests`.

---

## Map Image Decorator Chain

### CachingMapImageProvider

- Implements `MapImageProviderInterface`.
- Injected with `CacheInterface $mapImagesCache` (existing `map_images` pool, 30-day filesystem adapter).
- Cache key: `MapCacheKeyHelper::forMapImage($lng, $lat, $zoom, $width, $height)`.
- Replaces the manual `$this->mapImagesCache->get(...)` call in `MapController.buildImageResponse()`.

### RateLimitedMapImageProvider

- Implements `MapImageProviderInterface`.
- Injected with three `RateLimiterFactory` instances (all keyed to `"image-system"`):
  - `mapbox_image_daily` — 2500 / 24 h
  - `mapbox_image_weekly` — 13000 / 7 days
  - `mapbox_image_monthly` — 45000 / 30 days
- On cache miss: consumes 1 token from all three before delegating. Any exhausted → `RateLimitExceededException` → 429.

### Shared image dimensions

`IMAGE_ZOOM`, `IMAGE_WIDTH`, `IMAGE_HEIGHT` are moved from `MapController` private constants to kernel parameters `map.image.zoom`, `map.image.width`, `map.image.height` in `services.yaml`. Both `MapController` and `LocationMapCacheInvalidator` receive these as constructor arguments.

### LocationMapCacheInvalidator update

Switches from `delete('location_' . $id)` to `delete(MapCacheKeyHelper::forMapImage($lng, $lat, $zoom, $width, $height))` using the location's coordinates and the injected dimension parameters.

**Behaviour note**: If a location's coordinates change, the invalidator runs after the update and computes the new coordinate key — which does not yet exist in cache. The old cache entry (keyed on the previous coordinates) is orphaned and will expire after 30 days. This is acceptable: the old image is never served for the new coordinates since the key differs, and no data corruption occurs. If coordinates are unchanged, invalidation works as before.

---

## Proxy Service

### Allowed pattern configuration

Declared as a kernel parameter in `services.yaml`:

```yaml
parameters:
    mapbox.allowed_patterns:
        - pattern: '^/v4/[^/]+/[0-9]+/[0-9]+/[0-9]+'
          methods: ['GET']
          rate_limited: true
        - pattern: '^/styles/'
          methods: ['GET']
          rate_limited: false
        - pattern: '^/fonts/'
          methods: ['GET']
          rate_limited: false
```

The parameter is injected into `MapboxProxyService` as `array $allowedPatterns`.

### MapboxProxyService

Injected with:
- `array $allowedPatterns` (from parameter above)
- `CacheInterface $mapboxProxyCache` (pool: `mapbox_proxy`, 30-day filesystem adapter)
- `RateLimiterFactory $mapboxProxyDailyLimiter` — 2500 / 24 h, key `"proxy-system"`
- `RateLimiterFactory $mapboxProxyWeeklyLimiter` — 13000 / 7 days, key `"proxy-system"`
- `RateLimiterFactory $mapboxProxyMonthlyLimiter` — 45000 / 30 days, key `"proxy-system"`
- `HttpClientInterface $httpClient`
- `string $mapboxToken`

**Proxy flow** for `proxy(string $path, string $method, array $queryParams, ?string $body, string $contentType)`:

1. Find first pattern where `preg_match(pattern, "/{$path}")` succeeds and `$method` is in `pattern.methods`.
2. If no match → throw `ProxyDeniedException` → `MapboxController` returns 403.
3. If GET → check `mapbox_proxy` cache using `MapCacheKeyHelper::forProxyRequest($method, $path, $queryParams)` where `$queryParams` excludes `access_token`.
4. Cache hit → return cached `ProxyResponse` DTO.
5. If `pattern.rate_limited` → consume daily/weekly/monthly limiters. Any exhausted → `RateLimitExceededException` → 429.
6. Make upstream HTTP request. Strip hop-by-hop headers from response.
7. If GET and response status is 2xx, 404, or 410 → store in cache. All other statuses (5xx, 429, etc.) are not cached.
8. Return `ProxyResponse` DTO (status, headers, body string).

`MapboxController` maps `ProxyResponse` to a Symfony `Response`, continuing to strip the access token from forwarded query params and inject `$mapboxToken`.

---

## Exception Types

New in `App\Exception\`:

- `RateLimitExceededException` — caught by `MapController` and `MapboxController`, returns 429.
- `ProxyDeniedException` — caught by `MapboxController`, returns 403.

---

## Symfony Rate Limiter Configuration

New file `config/packages/rate_limiter.yaml`:

```yaml
framework:
    rate_limiter:
        geocoder_daily:
            policy: fixed_window
            limit: 3000
            interval: '24 hours'
        geocoder_hourly:
            policy: fixed_window
            limit: 50
            interval: '1 hour'
        mapbox_image_daily:
            policy: fixed_window
            limit: 2500
            interval: '24 hours'
        mapbox_image_weekly:
            policy: fixed_window
            limit: 13000
            interval: '7 days'
        mapbox_image_monthly:
            policy: fixed_window
            limit: 45000
            interval: '30 days'
        mapbox_proxy_daily:
            policy: fixed_window
            limit: 2500
            interval: '24 hours'
        mapbox_proxy_weekly:
            policy: fixed_window
            limit: 13000
            interval: '7 days'
        mapbox_proxy_monthly:
            policy: fixed_window
            limit: 45000
            interval: '30 days'
```

Storage: the auto-configured `cache.rate_limiter` filesystem pool.

---

## Cache Pool Configuration

Updated `config/packages/cache.yaml`:

```yaml
framework:
    cache:
        pools:
            map_images:
                adapter: cache.adapter.filesystem
                default_lifetime: '%env(int:MAP_IMAGE_CACHE_TTL)%'
            geocoder_responses:
                adapter: cache.adapter.filesystem
                default_lifetime: 3600
            mapbox_proxy:
                adapter: cache.adapter.filesystem
                default_lifetime: 2592000
```

---

## Files Changed / Created

| Action  | Path |
|---------|------|
| require | `symfony/rate-limiter` |
| new     | `config/packages/rate_limiter.yaml` |
| update  | `config/packages/cache.yaml` |
| update  | `config/services.yaml` |
| new     | `src/Exception/RateLimitExceededException.php` |
| new     | `src/Exception/ProxyDeniedException.php` |
| new     | `src/Service/Map/MapCacheKeyHelper.php` |
| new     | `src/Service/Map/RequestUserContext.php` |
| new     | `src/Service/Map/CachingGeocoderDecorator.php` |
| new     | `src/Service/Map/RateLimitedGeocoderDecorator.php` |
| new     | `src/Service/Map/CachingMapImageProvider.php` |
| new     | `src/Service/Map/RateLimitedMapImageProvider.php` |
| new     | `src/Service/Map/MapboxProxyService.php` |
| new     | `src/Service/Map/ProxyResponse.php` |
| update  | `src/Controller/MapController.php` |
| update  | `src/Controller/MapboxController.php` |
| update  | `src/EventListener/LocationMapCacheInvalidator.php` |
| new     | `tests/Unit/MapCacheKeyHelperTest.php` |
| new     | `tests/Unit/CachingGeocoderDecoratorTest.php` |
| new     | `tests/Unit/RateLimitedGeocoderDecoratorTest.php` |
| new     | `tests/Unit/CachingMapImageProviderTest.php` |
| new     | `tests/Unit/RateLimitedMapImageProviderTest.php` |
| new     | `tests/Unit/MapboxProxyServiceTest.php` |
| update  | `tests/Controller/MapControllerTest.php` |

---

## Testing Strategy

- **Unit tests** for each decorator: mock the inner service, assert cache is used on repeated calls and rate limiters are consumed on cache misses.
- **Controller tests** (`MapControllerTest`): wire fake decorators to verify 429 is returned when `RateLimitExceededException` is thrown.
- `LocationMapCacheInvalidatorTest` updated to verify the coordinate-based key is deleted.
- `MapboxProxyServiceTest`: covers pattern matching, method enforcement, cache hit/miss, rate limit flow, and upstream error handling.
