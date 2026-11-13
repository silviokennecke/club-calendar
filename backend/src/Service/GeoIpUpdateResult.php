<?php

declare(strict_types=1);

namespace App\Service;

final readonly class GeoIpUpdateResult
{
    public function __construct(
        public GeoIpUpdateStatus $status,
        public string $message,
        public ?\Throwable $error = null,
    ) {
    }
}
