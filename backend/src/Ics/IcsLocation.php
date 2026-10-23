<?php

declare(strict_types=1);

namespace App\Ics;

/** Location columns the ICS output uses (no entity). */
final readonly class IcsLocation
{
    public function __construct(
        public ?string $name,
        public ?string $street,
        public ?string $zip,
        public ?string $city,
        public ?string $country,
        public ?float $latitude,
        public ?float $longitude,
    ) {
    }
}
