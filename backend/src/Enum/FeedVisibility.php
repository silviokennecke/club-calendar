<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Status of a feed. PUBLIC and CLUB work the same (web view, ICS and single events reachable by link
 * without the secret); they differ only in the instruction to search engines: only a PUBLIC feed with
 * `searchable` may be indexed (CalendarFeed::isIndexable()). PRIVATE requires the shared secret.
 */
enum FeedVisibility: string
{
    case PUBLIC = 'PUBLIC';
    case CLUB = 'CLUB';
    case PRIVATE = 'PRIVATE';

    public function requiresSecret(): bool
    {
        return self::PRIVATE === $this;
    }
}
