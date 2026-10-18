<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Locations, target groups and feeds move from calendar scope to club scope
 * (`calendar_id` -> `club_id`). Nothing is merged or deduplicated: every row simply moves to the club of
 * its calendar. A feed now selects 1..n calendars (`calendar_feed_calendar`); each existing feed gets exactly
 * its one old calendar, ids and shared secrets stay untouched.
 *
 * down() restores `calendar_id`: a feed gets its first linked calendar, a reference row the calendar of its
 * club that uses it most (else the club's smallest calendar id). It refuses to run when that would lose
 * information (see preDown()).
 */
final class Version20261020120000 extends AbstractMigration
{
    private const TABLES = ['location', 'target_group', 'calendar_feed'];

    /** Reference table => [link table, link column, owner table, owner column] pairs that use a row. */
    private const USAGE = [
        'location' => [['event', 'location_id', null, null], ['event_template', 'location_id', null, null]],
        'target_group' => [['event_target_group', 'target_group_id', 'event', 'event_id'], ['event_template_target_group', 'target_group_id', 'event_template', 'template_id']],
    ];

    public function getDescription(): string
    {
        return 'Move location, target_group and calendar_feed to club scope; calendar_feed_calendar';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE calendar_feed_calendar (feed_id VARCHAR(36) NOT NULL, calendar_id VARCHAR(36) NOT NULL, INDEX '.$this->ident('calendar_feed_calendar', 'feed_id').' (feed_id), INDEX '.$this->ident('calendar_feed_calendar', 'calendar_id').' (calendar_id), PRIMARY KEY (feed_id, calendar_id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci`');
        $this->addSql('ALTER TABLE calendar_feed_calendar ADD CONSTRAINT '.$this->ident('calendar_feed_calendar', 'feed_id', 'FK').' FOREIGN KEY (feed_id) REFERENCES calendar_feed (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE calendar_feed_calendar ADD CONSTRAINT '.$this->ident('calendar_feed_calendar', 'calendar_id', 'FK').' FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE');
        $this->addSql('INSERT INTO calendar_feed_calendar (feed_id, calendar_id) SELECT id, calendar_id FROM calendar_feed');

        foreach (self::TABLES as $table) {
            $this->addSql("ALTER TABLE $table ADD club_id VARCHAR(36) DEFAULT NULL");
            $this->addSql("UPDATE $table t INNER JOIN calendar c ON c.id = t.calendar_id SET t.club_id = c.club_id");
            $this->addSql("ALTER TABLE $table MODIFY club_id VARCHAR(36) NOT NULL");
            $this->addSql("ALTER TABLE $table ADD CONSTRAINT ".$this->ident($table, 'club_id', 'FK').' FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE');
            $this->addSql('CREATE INDEX '.$this->ident($table, 'club_id')." ON $table (club_id)");

            // The old foreign key, its index and the column: names are looked up, not assumed.
            foreach ($this->foreignKeys($table, 'calendar_id') as $fk) {
                $this->addSql("ALTER TABLE $table DROP FOREIGN KEY `$fk`");
            }
            foreach ($this->indexes($table, 'calendar_id') as $index) {
                $this->addSql("DROP INDEX `$index` ON $table");
            }
            $this->addSql("ALTER TABLE $table DROP calendar_id");
        }
    }

    public function preDown(Schema $schema): void
    {
        $multi = (int) $this->connection->fetchOne('SELECT COUNT(*) FROM (SELECT feed_id FROM calendar_feed_calendar GROUP BY feed_id HAVING COUNT(*) > 1) x');
        $this->abortIf($multi > 0, sprintf('Cannot roll back: %d feed(s) select more than one calendar, which the old schema cannot represent. Reduce them to one calendar first.', $multi));
        $none = (int) $this->connection->fetchOne('SELECT COUNT(*) FROM calendar_feed f WHERE NOT EXISTS (SELECT 1 FROM calendar_feed_calendar fc WHERE fc.feed_id = f.id)');
        $this->abortIf($none > 0, sprintf('Cannot roll back: %d feed(s) have no calendar.', $none));

        foreach (self::TABLES as $table) {
            $orphans = (int) $this->connection->fetchOne("SELECT COUNT(*) FROM $table t WHERE NOT EXISTS (SELECT 1 FROM calendar c WHERE c.club_id = t.club_id)");
            $this->abortIf($orphans > 0, sprintf('Cannot roll back: %d row(s) of "%s" belong to a club without any calendar.', $orphans, $table));
        }
        foreach (array_keys(self::USAGE) as $table) {
            $conflicts = (int) $this->connection->fetchOne(
                "SELECT COUNT(*) FROM (SELECT row_id FROM ({$this->usageSql($table)}) u GROUP BY row_id HAVING COUNT(DISTINCT calendar_id) > 1) x",
            );
            $this->abortIf($conflicts > 0, sprintf('Cannot roll back: %d row(s) of "%s" are used by events/templates of different calendars, which the old per-calendar schema cannot represent.', $conflicts, $table));
        }
    }

    public function down(Schema $schema): void
    {
        foreach (self::TABLES as $table) {
            $this->addSql("ALTER TABLE $table ADD calendar_id VARCHAR(36) DEFAULT NULL");
        }
        $this->addSql('UPDATE calendar_feed f SET f.calendar_id = (SELECT MIN(fc.calendar_id) FROM calendar_feed_calendar fc WHERE fc.feed_id = f.id)');
        foreach (self::USAGE as $table => $unused) {
            $this->addSql(
                "UPDATE $table t SET t.calendar_id = COALESCE(
                    (SELECT u.calendar_id FROM ({$this->usageSql($table)}) u WHERE u.row_id = t.id GROUP BY u.calendar_id ORDER BY COUNT(*) DESC, u.calendar_id LIMIT 1),
                    (SELECT MIN(c.id) FROM calendar c WHERE c.club_id = t.club_id)
                )",
            );
        }

        foreach (self::TABLES as $table) {
            $this->addSql("ALTER TABLE $table MODIFY calendar_id VARCHAR(36) NOT NULL");
            $this->addSql("ALTER TABLE $table ADD CONSTRAINT ".$this->ident($table, 'calendar_id', 'FK').' FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE');
            $this->addSql('CREATE INDEX '.$this->ident($table, 'calendar_id')." ON $table (calendar_id)");
            foreach ($this->foreignKeys($table, 'club_id') as $fk) {
                $this->addSql("ALTER TABLE $table DROP FOREIGN KEY `$fk`");
            }
            foreach ($this->indexes($table, 'club_id') as $index) {
                $this->addSql("DROP INDEX `$index` ON $table");
            }
            $this->addSql("ALTER TABLE $table DROP club_id");
        }
        $this->addSql('DROP TABLE calendar_feed_calendar');
    }

    /** SQL yielding (row_id, calendar_id) for every use of a reference row by an event or a template. */
    private function usageSql(string $table): string
    {
        $parts = [];
        foreach (self::USAGE[$table] as [$link, $column, $owner, $ownerColumn]) {
            $parts[] = null === $owner
                ? "SELECT l.$column AS row_id, l.calendar_id FROM $link l WHERE l.$column IS NOT NULL"
                : "SELECT l.$column AS row_id, o.calendar_id FROM $link l INNER JOIN $owner o ON o.id = l.$ownerColumn";
        }

        return implode(' UNION ALL ', $parts);
    }

    /** Doctrine's generated identifier: prefix + upper-case hex of crc32(table) and crc32(column). */
    private function ident(string $table, string $column, string $prefix = 'IDX'): string
    {
        return $prefix.'_'.strtoupper(dechex(crc32($table)).dechex(crc32($column)));
    }

    /** @return list<string> */
    private function foreignKeys(string $table, string $column): array
    {
        return array_map('strval', $this->connection->fetchFirstColumn(
            'SELECT constraint_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? AND referenced_table_name IS NOT NULL',
            [$table, $column],
        ));
    }

    /** @return list<string> indexes whose only column is $column (the PRIMARY key never is) */
    private function indexes(string $table, string $column): array
    {
        return array_map('strval', $this->connection->fetchFirstColumn(
            'SELECT index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name <> \'PRIMARY\' GROUP BY index_name HAVING MIN(column_name) = ? AND MAX(column_name) = ?',
            [$table, $column, $column],
        ));
    }
}
