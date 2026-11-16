<?php

declare(strict_types=1);

namespace App\Enum;

/** What a resource stands for; conflicts are checked against it. Only `location` for now. */
enum ResourceType: string
{
    case LOCATION = 'location';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $t) => $t->value, self::cases());
    }
}
