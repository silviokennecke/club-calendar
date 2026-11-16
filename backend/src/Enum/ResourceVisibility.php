<?php

declare(strict_types=1);

namespace App\Enum;

/** Who sees a resource: STAFF = viewer, editor, admin; MEMBERS = every club member. */
enum ResourceVisibility: string
{
    case STAFF = 'staff';
    case MEMBERS = 'members';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $v) => $v->value, self::cases());
    }
}
