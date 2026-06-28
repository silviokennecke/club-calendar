<?php

declare(strict_types=1);

namespace App\Service\Map;

interface GeocoderInterface
{
    /** @return SuggestionResult[] */
    public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array;

    public function reverse(float $lng, float $lat): ?GeocodedAddress;
}
