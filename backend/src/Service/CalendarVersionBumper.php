<?php

declare(strict_types=1);

namespace App\Service;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;
use Symfony\Component\Uid\Uuid;

/**
 * Overwrites calendar.content_version with a fresh UUIDv7 (blind write, no read-modify-write). Used by
 * ContentVersionListener for every flush and called explicitly after bulk SQL/DQL statements that bypass the
 * unit of work (see CLAUDE.md "Content version").
 */
class CalendarVersionBumper
{
    public function __construct(private readonly Connection $connection)
    {
    }

    /** @param string[] $calendarIds */
    public function bumpCalendars(array $calendarIds): void
    {
        $calendarIds = array_values(array_unique($calendarIds));
        if ([] === $calendarIds) {
            return;
        }
        $this->connection->executeStatement(
            'UPDATE calendar SET content_version = ? WHERE id IN (?)',
            [Uuid::v7()->toRfc4122(), $calendarIds],
            [ParameterType::STRING, ArrayParameterType::STRING],
        );
    }

    /** @param string[] $clubIds */
    public function bumpClubs(array $clubIds): void
    {
        $clubIds = array_values(array_unique($clubIds));
        if ([] === $clubIds) {
            return;
        }
        $this->connection->executeStatement(
            'UPDATE calendar SET content_version = ? WHERE club_id IN (?)',
            [Uuid::v7()->toRfc4122(), $clubIds],
            [ParameterType::STRING, ArrayParameterType::STRING],
        );
    }

    public function bumpClub(string $clubId): void
    {
        $this->bumpClubs([$clubId]);
    }
}
