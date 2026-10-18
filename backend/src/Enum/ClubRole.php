<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Role of a member within a club (security audit: roles / last admin). Each role includes the rights of the
 * ones below it: VIEWER reads, EDITOR also changes events and reference data, ADMIN also manages the club,
 * its calendars, feeds, members, roles and invitations.
 */
enum ClubRole: string
{
    case VIEWER = 'viewer';
    case EDITOR = 'editor';
    case ADMIN = 'admin';

    /** The role a new invitation carries when the inviter names none. */
    public const self DEFAULT_INVITED = self::EDITOR;

    public function level(): int
    {
        return match ($this) {
            self::VIEWER => 1,
            self::EDITOR => 2,
            self::ADMIN => 3,
        };
    }

    public function atLeast(self $required): bool
    {
        return $this->level() >= $required->level();
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $r) => $r->value, self::cases());
    }
}
