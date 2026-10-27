<?php

declare(strict_types=1);

namespace App\Service;

/** Validated filter of an event export (ICS and PDF share it). */
final readonly class ExportFilter
{
    /**
     * @param list<string> $groupIds target group ids of the calendar's club, empty = no filter
     */
    public function __construct(
        public ?\DateTimeImmutable $fromDate,
        public ?\DateTimeImmutable $toDate,
        public bool $drafts,
        public array $groupIds,
    ) {
    }
}
