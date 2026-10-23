<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\CalendarFeed;

/** Checked access, resolved filter/window and ETag of a feed ICS request (see PublicFeedService::prepareFeedIcs). */
final readonly class FeedIcsPlan
{
    /** @param string[]|null $targetGroupIds effective filter set */
    public function __construct(
        public CalendarFeed $feed,
        public ?array $targetGroupIds,
        public ?\DateTimeImmutable $from,
        public ?\DateTimeImmutable $to,
        public string $etag,
    ) {
    }
}
