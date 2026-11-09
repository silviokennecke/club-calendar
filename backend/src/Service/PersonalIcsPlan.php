<?php

declare(strict_types=1);

namespace App\Service;

/** Checked access, resolved filter/window and ETag of a personal ICS request (see PersonalFeedService::prepareIcs). */
final readonly class PersonalIcsPlan
{
    /** @param string[]|null $targetGroupIds requested (subscription) filter set; null = all groups */
    public function __construct(
        public PersonalSelection $selection,
        public ?array $targetGroupIds,
        public bool $hasEvents,
        public ?\DateTimeImmutable $from,
        public ?\DateTimeImmutable $to,
        public string $etag,
    ) {
    }
}
