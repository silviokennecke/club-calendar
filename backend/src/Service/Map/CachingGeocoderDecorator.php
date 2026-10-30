<?php

declare(strict_types=1);

namespace App\Service\Map;

use Geocoder\Collection;
use Geocoder\Provider\Provider;
use Geocoder\Query\GeocodeQuery;
use Geocoder\Query\ReverseQuery;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

readonly class CachingGeocoderDecorator implements Provider
{
    public function __construct(
        private Provider $inner,
        private CacheInterface $geocoderResponsesCache,
    ) {
    }

    public function geocodeQuery(GeocodeQuery $query): Collection
    {
        $key = MapCacheKeyHelper::forGeocoderSuggest($query->getText(), $query->getLimit());

        return $this->geocoderResponsesCache->get($key, fn (ItemInterface $item): Collection => $this->inner->geocodeQuery($query));
    }

    public function reverseQuery(ReverseQuery $query): Collection
    {
        $coordinates = $query->getCoordinates();
        $key = MapCacheKeyHelper::forGeocoderReverse($coordinates->getLongitude(), $coordinates->getLatitude());

        return $this->geocoderResponsesCache->get($key, fn (ItemInterface $item): Collection => $this->inner->reverseQuery($query));
    }

    public function getName(): string
    {
        return $this->inner->getName();
    }
}
