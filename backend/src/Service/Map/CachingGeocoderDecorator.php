<?php

declare(strict_types=1);

namespace App\Service\Map;

use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

readonly class CachingGeocoderDecorator implements GeocoderInterface
{
    public function __construct(
        private GeocoderInterface $inner,
        private CacheInterface $geocoderResponsesCache,
    ) {
    }

    public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
    {
        $key = MapCacheKeyHelper::forGeocoderSuggest($query, $proximityLat, $proximityLng, $limit);

        return $this->geocoderResponsesCache->get($key, function (ItemInterface $item) use ($query, $proximityLat, $proximityLng, $limit): array {
            return $this->inner->suggest($query, $proximityLat, $proximityLng, $limit);
        });
    }

    public function reverse(float $lng, float $lat): ?GeocodedAddress
    {
        $key = MapCacheKeyHelper::forGeocoderReverse($lng, $lat);

        return $this->geocoderResponsesCache->get($key, function (ItemInterface $item) use ($lng, $lat): ?GeocodedAddress {
            return $this->inner->reverse($lng, $lat);
        });
    }
}
