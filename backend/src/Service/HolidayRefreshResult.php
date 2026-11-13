<?php

declare(strict_types=1);

namespace App\Service;

final readonly class HolidayRefreshResult
{
    public function __construct(
        public string $name,
        public ?int $events = null,
        public ?\Throwable $error = null,
    ) {
    }
}
