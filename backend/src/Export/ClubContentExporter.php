<?php

declare(strict_types=1);

namespace App\Export;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;

/**
 * Part of the user data export: everything in the clubs that the user last changed (audit field
 * `updated_by_id`) or created (feed members, invitations), grouped by club and entity type.
 * Plain SQL with explicit column lists and keyset pagination; nothing is hydrated, so memory stays flat.
 * Names are labels only: no other person's address, name or id is read (member and invitation rows carry
 * no label), and no secret column is selected.
 */
final class ClubContentExporter
{
    public const int BATCH_SIZE = 500;

    /**
     * type => from (aliased `t`), club expression, key (unique per user and club), id, label, extra columns,
     * relations [relation, user column, "at" column].
     *
     * @var array<string, array{from: string, club: string, key: string, id: string, name: string, extra?: array<string, string>, relations: list<array{string, string, string}>}>
     */
    private const array TYPES = [
        'club' => [
            'from' => 'club t', 'club' => 't.id', 'key' => 't.id', 'id' => 't.id', 'name' => 't.name',
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'calendar' => [
            'from' => 'calendar t', 'club' => 't.club_id', 'key' => 't.id', 'id' => 't.id', 'name' => 't.name',
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'calendarFeed' => [
            'from' => 'calendar_feed t', 'club' => 't.club_id', 'key' => 't.id', 'id' => 't.id', 'name' => 't.name',
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'event' => [
            'from' => 'event t INNER JOIN calendar c ON c.id = t.calendar_id', 'club' => 'c.club_id', 'key' => 't.id',
            'id' => 't.id', 'name' => 't.name',
            'extra' => ['date' => 't.date', 'calendarId' => 't.calendar_id', 'calendarName' => 'c.name'],
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'eventSeries' => [
            'from' => 'event_series t INNER JOIN calendar c ON c.id = t.calendar_id', 'club' => 'c.club_id', 'key' => 't.id',
            'id' => 't.id', 'name' => "CONCAT_WS(' ', t.frequency, t.start_date)",
            'extra' => ['calendarId' => 't.calendar_id', 'calendarName' => 'c.name'],
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'eventTemplate' => [
            'from' => 'event_template t INNER JOIN calendar c ON c.id = t.calendar_id', 'club' => 'c.club_id', 'key' => 't.id',
            'id' => 't.id', 'name' => 't.name',
            'extra' => ['calendarId' => 't.calendar_id', 'calendarName' => 'c.name'],
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'property' => [
            'from' => 'property t INNER JOIN calendar c ON c.id = t.calendar_id', 'club' => 'c.club_id', 'key' => 't.id',
            'id' => 't.id', 'name' => 't.name',
            'extra' => ['calendarId' => 't.calendar_id', 'calendarName' => 'c.name'],
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'feature' => [
            'from' => 'feature t INNER JOIN calendar c ON c.id = t.calendar_id', 'club' => 'c.club_id', 'key' => 't.id',
            'id' => 't.id', 'name' => 't.name',
            'extra' => ['calendarId' => 't.calendar_id', 'calendarName' => 'c.name'],
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'targetGroup' => [
            'from' => 'target_group t', 'club' => 't.club_id', 'key' => 't.id', 'id' => 't.id', 'name' => 't.name',
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'location' => [
            'from' => 'location t', 'club' => 't.club_id', 'key' => 't.id', 'id' => 't.id', 'name' => 'COALESCE(t.name, t.city)',
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'holidayCalendar' => [
            'from' => 'holiday_calendar t INNER JOIN calendar c ON c.id = t.calendar_id', 'club' => 'c.club_id', 'key' => 't.id',
            'id' => 't.id', 'name' => 't.name',
            'extra' => ['calendarId' => 't.calendar_id', 'calendarName' => 'c.name'],
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'holidayEvent' => [
            'from' => 'holiday_event t INNER JOIN holiday_calendar h ON h.id = t.holiday_calendar_id INNER JOIN calendar c ON c.id = h.calendar_id',
            'club' => 'c.club_id', 'key' => 't.id', 'id' => 't.id', 'name' => 't.name',
            'extra' => ['date' => 't.date', 'calendarId' => 'h.calendar_id', 'calendarName' => 'c.name'],
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        // The member is another person: no id and no label.
        'clubMember' => [
            'from' => 'club_user t', 'club' => 't.club_id', 'key' => 't.club_id', 'id' => 'NULL', 'name' => 'NULL',
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        // The invitee's address is never read.
        'clubInvitation' => [
            'from' => 'club_invitation t', 'club' => 't.club_id', 'key' => 't.id', 'id' => 't.id', 'name' => 'NULL',
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at'], ['createdBy', 't.invited_by_id', 't.created_at']],
        ],
        'memberSubscription' => [
            'from' => 'member_subscription t', 'club' => 't.club_id', 'key' => 't.id',
            'id' => 'CASE WHEN t.user_id = :self THEN t.id END', 'name' => 'NULL',
            'relations' => [['lastUpdatedBy', 't.updated_by_id', 't.updated_at']],
        ],
        'feedMember' => [
            'from' => 'feed_member t INNER JOIN calendar_feed f ON f.id = t.feed_id', 'club' => 'f.club_id', 'key' => 't.id',
            'id' => 't.id', 'name' => 'f.name',
            'relations' => [['createdBy', 't.created_by_id', 't.created_at']],
        ],
    ];

    public function __construct(private readonly Connection $connection)
    {
    }

    /** @return list<string> the entity types that can appear in the export */
    public static function types(): array
    {
        return array_keys(self::TYPES);
    }

    /**
     * Writes the value of `clubContent`: an array of clubs with their entities.
     *
     * @return \Generator<int, string> text pieces
     */
    public function write(JsonStreamWriter $w, string $userId): \Generator
    {
        $w->beginArray();
        foreach ($this->clubs($userId) as $clubId => $clubName) {
            $w->beginObject()->field('clubId', $clubId)->field('clubName', $clubName)->key('entities')->beginObject();
            foreach (self::TYPES as $type => $def) {
                $opened = false;
                foreach ($def['relations'] as [$relation, $userColumn, $atColumn]) {
                    foreach ($this->batches($def, $userColumn, $atColumn, $clubId, $userId) as $rows) {
                        if (!$opened) {
                            $w->key($type)->beginArray();
                            $opened = true;
                        }
                        foreach ($rows as $row) {
                            $w->value($this->item($type, $relation, $row, $def));
                        }
                        yield $w->flush();
                    }
                }
                if ($opened) {
                    $w->endArray();
                }
            }
            $w->endObject()->endObject();
            yield $w->flush();
        }
        $w->endArray();
        yield $w->flush();
    }

    /**
     * @param array<string, mixed> $row
     * @param array<string, mixed> $def
     *
     * @return array<string, mixed>
     */
    private function item(string $type, string $relation, array $row, array $def): array
    {
        $item = ['type' => $type, 'id' => $row['id'], 'name' => $row['name'], 'relation' => $relation, 'at' => self::utc($row['ts'])];
        foreach (array_keys($def['extra'] ?? []) as $name) {
            $item[$name] = $row[$name];
        }

        return $item;
    }

    /** @return array<string, string> club id => name, ordered by name, id */
    private function clubs(string $userId): array
    {
        $ids = [];
        foreach (self::TYPES as $def) {
            foreach ($def['relations'] as [, $userColumn]) {
                $sql = sprintf('SELECT DISTINCT %s AS club_id FROM %s WHERE %s = :user', $def['club'], $def['from'], $userColumn);
                foreach ($this->connection->executeQuery($sql, self::params($sql, ['user' => $userId]))->iterateColumn() as $id) {
                    $ids[(string) $id] = true;
                }
            }
        }
        if ([] === $ids) {
            return [];
        }
        $rows = $this->connection->executeQuery(
            'SELECT id, name FROM club WHERE id IN (?) ORDER BY name, id',
            [array_keys($ids)],
            [ArrayParameterType::STRING],
        )->fetchAllKeyValue();

        return array_map('strval', $rows);
    }

    /**
     * @param array<string, mixed> $def
     *
     * @return \Generator<int, list<array<string, mixed>>>
     */
    private function batches(array $def, string $userColumn, string $atColumn, string $clubId, string $userId): \Generator
    {
        $select = [sprintf('%s AS k', $def['key']), sprintf('%s AS id', $def['id']), sprintf('%s AS name', $def['name']), sprintf('%s AS ts', $atColumn)];
        foreach ($def['extra'] ?? [] as $alias => $expr) {
            $select[] = sprintf('%s AS %s', $expr, $alias);
        }
        $sql = sprintf(
            'SELECT %s FROM %s WHERE %s = :club AND %s = :user AND %s > :last ORDER BY %s LIMIT %d',
            implode(', ', $select), $def['from'], $def['club'], $userColumn, $def['key'], $def['key'], self::BATCH_SIZE,
        );
        $last = '';
        while (true) {
            $rows = $this->connection->executeQuery(
                $sql,
                self::params($sql, ['club' => $clubId, 'user' => $userId, 'last' => $last]),
            )->fetchAllAssociative();
            if ([] === $rows) {
                return;
            }
            yield $rows;
            if (count($rows) < self::BATCH_SIZE) {
                return;
            }
            $last = (string) $rows[array_key_last($rows)]['k'];
        }
    }

    /**
     * @param array<string, string> $params
     *
     * @return array<string, string>
     */
    private static function params(string $sql, array $params): array
    {
        return str_contains($sql, ':self') ? $params + ['self' => $params['user']] : $params;
    }

    private static function utc(mixed $value): ?string
    {
        return null === $value ? null : (new \DateTimeImmutable((string) $value, new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z');
    }
}
