<?php
declare(strict_types=1);

namespace App\Service\Map;

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
