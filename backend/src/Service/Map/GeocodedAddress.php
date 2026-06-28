<?php

declare(strict_types=1);

namespace App\Service\Map;

readonly class GeocodedAddress
{
    public function __construct(
        public string $label,
        public ?string $street = null,
        public ?string $zip = null,
        public ?string $city = null,
        public ?string $country = null,
    ) {
    }
}
