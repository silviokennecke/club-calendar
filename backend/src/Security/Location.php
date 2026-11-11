<?php

declare(strict_types=1);

namespace App\Security;

/** Country as ISO-3166 alpha-2. */
final readonly class Location
{
    public function __construct(
        public ?string $city = null,
        public ?string $country = null,
    ) {
    }
}
