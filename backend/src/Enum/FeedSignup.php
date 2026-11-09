<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Club setting: which feeds let a non-member join the club by opening them while signed in.
 * OFF: none; INTERNAL: CLUB and PRIVATE feeds (the link or secret is the invitation); PUBLIC: PUBLIC feeds too.
 */
enum FeedSignup: string
{
    case OFF = 'off';
    case INTERNAL = 'internal';
    case PUBLIC = 'public';

    public function allows(FeedVisibility $visibility): bool
    {
        return match ($this) {
            self::OFF => false,
            self::INTERNAL => FeedVisibility::PUBLIC !== $visibility,
            self::PUBLIC => true,
        };
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $s) => $s->value, self::cases());
    }
}
