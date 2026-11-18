<?php

declare(strict_types=1);

namespace App\Enum;

/** `notice` (Hinweis / Notice): all-day information without location, badges, extras or template. */
enum EventType: string
{
    case Event = 'event';
    case Notice = 'notice';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $t) => $t->value, self::cases());
    }
}
