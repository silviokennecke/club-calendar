<?php

declare(strict_types=1);

namespace App\Security;

final readonly class ClientContext
{
    public function __construct(
        public ?string $ip = null,
        public ?string $browser = null,
        public ?string $city = null,
        public ?string $country = null,
    ) {
    }
}
