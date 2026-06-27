# Design: Mapbox Backend Proxy — Geocoding & Static Map Images

**Date:** 2026-06-28  
**Status:** Approved

## Problem

The frontend makes Mapbox-shaped API calls through a dumb transparent proxy (`MapboxController`). Two categories need replacing with provider-agnostic backend endpoints:

1. **Geocoding** — `MapPicker.tsx` calls `/api/mapbox/api.mapbox.com/geocoding/v5/mapbox.places/…` for address suggestions (forward) and reverse geocoding. The URL shape leaks the Mapbox API structure into the frontend.
2. **Static map images** — `FeedPage.tsx:60` builds a Mapbox Static Images API URL inline and fetches it through the dumb proxy. Coordinates are exposed in the URL; there is no caching.

The interactive map (GL JS tiles, styles) continues to flow through the existing dumb proxy unchanged.

## Goals

- Replace Mapbox-specific URLs in the frontend with stable, provider-agnostic backend endpoints.
- Abstract geocoding behind the `geocoder-php` library (BazingaGeocoderBundle + Mapbox provider) so swapping providers is a config change only.
- Abstract static map image fetching behind an interface so the provider can be swapped independently.
- Cache static map images server-side (dedicated pool, configurable TTL, default 24 h).
- Invalidate cached map images when a location's coordinates change.

## Out of Scope

- Replacing the existing dumb proxy for interactive GL JS map tiles/styles.
- Adding new map UI features.

---

## Backend: Service Layer

### Directory: `backend/src/Service/Map/`

#### Value Objects (readonly classes, no ORM)

```php
readonly class SuggestionResult
{
    public function __construct(
        public string $label,
        public float $lat,
        public float $lng,
        public ?string $street = null,
        public ?string $zip = null,
        public ?string $city = null,
        public ?string $country = null,
    ) {}
}

readonly class GeocodedAddress
{
    public function __construct(
        public string $label,
        public ?string $street = null,
        public ?string $zip = null,
        public ?string $city = null,
        public ?string $country = null,
    ) {}
}
```

#### `GeocoderInterface`

```php
interface GeocoderInterface
{
    /** @return SuggestionResult[] */
    public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array;

    public function reverse(float $lng, float $lat): ?GeocodedAddress;
}
```

#### `BazingaGeocoderAdapter implements GeocoderInterface`

- Injects the bundle-registered `\Geocoder\StatefulGeocoder` (configured for the Mapbox provider).
- Translates `AddressCollection` → `SuggestionResult[]` and `Address` → `GeocodedAddress`.
- Because geocoder-php normalises all providers to the same `Address` model, this adapter is provider-agnostic — swapping from Mapbox to any other provider requires no code change.

#### `MapImageProviderInterface`

```php
interface MapImageProviderInterface
{
    /**
     * Returns raw image bytes (JPEG).
     */
    public function getImage(float $lng, float $lat, int $zoom, int $width, int $height): string;
}
```

#### `MapboxMapImageProvider implements MapImageProviderInterface`

- Injects `MAPBOX_TOKEN` env var and Symfony's `HttpClientInterface`.
- Calls the Mapbox Static Images API: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+2563eb({lng},{lat})/{lng},{lat},{zoom},0/{width}x{height}`.
- Returns raw JPEG bytes.

---

## Backend: Bundle Configuration

### `backend/config/packages/bazinga_geocoder.yaml`

```yaml
bazinga_geocoder:
    providers:
        mapbox:
            factory: Geocoder\Provider\Mapbox\Mapbox
            options:
                api_key: '%env(MAPBOX_TOKEN)%'
```

### `backend/config/packages/cache.yaml` (addition)

```yaml
framework:
    cache:
        pools:
            map_images:
                adapter: cache.adapter.filesystem
                default_lifetime: '%env(int:default:86400:MAP_IMAGE_CACHE_TTL)%'
```

- Default TTL: 86400 seconds (24 h).
- Override via `MAP_IMAGE_CACHE_TTL` env var.

---

## Backend: Controller

### `MapController.php` — `#[Route('/api/map')]`

Auth is enforced per-endpoint with `#[IsGranted('ROLE_USER')]`:
- **Geocode endpoints** — require auth (`#[IsGranted]`): only used in the admin `MapPicker` component.
- **Map image endpoints** — no auth required: the `FeedPage` is a public route that sends no token, and `access_control: []` in `security.yaml` means the JWT firewall does not block unauthenticated requests.

#### `GET /api/map/geocode/suggest`

Query params: `q` (required), `lat` (optional float), `lng` (optional float), `limit` (optional int, default 6).

Response `200`:
```json
{ "suggestions": [{ "label": "…", "street": "…", "zip": "…", "city": "…", "country": "…", "lat": 0.0, "lng": 0.0 }] }
```
Empty array when no results. `503` when `MAPBOX_TOKEN` not configured.

#### `GET /api/map/geocode/reverse`

Query params: `lat` (required float), `lng` (required float).

Response `200`:
```json
{ "label": "…", "street": "…", "zip": "…", "city": "…", "country": "…" }
```
`404` when no address found. `503` when token not configured.

#### `GET /api/map/image/location/{id}`

- Looks up `Location` entity by ID.
- `404` if not found or coordinates are null.
- Checks `map_images` cache (`location_{id}` key). On miss, calls `MapImageProviderInterface::getImage()` at fixed size **800×288**, zoom **14**, stores result.
- Returns `200 image/jpeg` with `Cache-Control: public, max-age=86400`.

#### `GET /api/map/image/event/{id}`

- Looks up `Event` entity, resolves its `location`.
- `404` if event not found, has no location, or location has no coordinates.
- Delegates to the same cache/provider logic as the location endpoint, keyed by `location_{locationId}`.

---

## Backend: Cache Invalidation

### `LocationMapCacheInvalidator`

Doctrine entity listener registered with `#[AsEntityListener]`:

```php
#[AsEntityListener(event: Events::preUpdate, entity: Location::class)]
#[AsEntityListener(event: Events::postUpdate, entity: Location::class)]
class LocationMapCacheInvalidator
{
    private array $pendingIds = [];

    public function __construct(
        #[Target('map_images')] private readonly CacheInterface $mapImagesCache,
    ) {}

    public function preUpdate(Location $location, PreUpdateEventArgs $args): void
    {
        if ($args->hasChangedField('latitude') || $args->hasChangedField('longitude')) {
            $this->pendingIds[] = $location->getId();
        }
    }

    public function postUpdate(Location $location, PostUpdateEventArgs $args): void
    {
        if (in_array($location->getId(), $this->pendingIds, true)) {
            $this->mapImagesCache->delete('location_' . $location->getId());
            $this->pendingIds = array_values(
                array_filter($this->pendingIds, fn($id) => $id !== $location->getId())
            );
        }
    }
}
```

- `preUpdate` reads the Doctrine changeset — only flags locations where `latitude` or `longitude` changed.
- `postUpdate` performs the actual cache delete after the DB commit (never clears for rolled-back writes).

---

## Frontend Changes

### `MapPicker.tsx`

- Replace `reverseGeocode` fetch: `GET /api/map/geocode/reverse?lat=…&lng=…` → parse `{ label, street, zip, city, country }` directly into `GeocodedAddress`. Remove `parseFeature` helper and `GeocodingFeature` interface.
- Replace `fetchSuggestions` fetch: `GET /api/map/geocode/suggest?q=…&lat=…&lng=…&limit=6` → `suggestions` array maps directly to `SuggestionResult[]`. Remove Mapbox feature parsing.
- Remove `BACKEND_URL` import from `mapboxProxy`; use `import.meta.env.VITE_API_URL` (or a shared `api.ts` constant) directly.

### `FeedPage.tsx`

- Line 60: replace the inline Mapbox static image URL with:
  ```tsx
  <img
    src={`${BASE}/api/map/image/location/${ev.location!.id}`}
    alt="Location map"
    className="w-full h-full object-cover"
  />
  ```
- The container already has fixed dimensions; `object-cover` crops the 800×288 image to fit.

---

## Packages to Install

```bash
# Backend
composer require geocoder-php/bazinga-geocoder-bundle geocoder-php/mapbox-provider symfony/http-client php-http/httplug
```

`symfony/http-client` is already installed. `php-http/httplug` is the PSR-18 adapter interface required by geocoder-php; the Symfony HttpClient PSR-18 bridge (`psr/http-client`) covers the implementation.

No new frontend packages required.

---

## Testing

- PHPUnit integration tests for `MapController` (suggest, reverse, image/location, image/event) covering 200, 404, 503 paths.
- Unit test for `BazingaGeocoderAdapter` with a mock geocoder.
- Unit test for `LocationMapCacheInvalidator` verifying cache is only cleared when coordinates change.
