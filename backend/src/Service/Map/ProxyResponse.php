<?php

declare(strict_types=1);

namespace App\Service\Map;

readonly class ProxyResponse
{
    public function __construct(
        public int $status,
        public array $headers,
        public string $body,
    ) {
    }
}
