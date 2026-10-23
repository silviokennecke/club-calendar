<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/** Audit fields updated_at/updated_by_id on the domain tables (see UpdateAuditListener). */
final class Version20261027120000 extends AbstractMigration
{
    /** table => [foreign key name, initial updated_at for existing rows (null: column exists already)] */
    private const TABLES = [
        'calendar' => ['FK_6EA9A146896DBBDE', 'NOW()'],
        'calendar_feed' => ['FK_71D6C7FF896DBBDE', 'NOW()'],
        'club' => ['FK_B8EE3872896DBBDE', 'NOW()'],
        'club_invitation' => ['FK_B8DB2F4F896DBBDE', 'created_at'],
        'club_user' => ['FK_E95B1CA9896DBBDE', 'NOW()'],
        'event' => ['FK_3BAE0AA7896DBBDE', 'NOW()'],
        'event_series' => ['FK_889767F896DBBDE', 'created_at'],
        'event_template' => ['FK_D18CF653896DBBDE', 'NOW()'],
        'feature' => ['FK_1FD77566896DBBDE', 'NOW()'],
        'holiday_calendar' => ['FK_89235104896DBBDE', 'NOW()'],
        'holiday_event' => ['FK_12143560896DBBDE', 'NOW()'],
        'location' => ['FK_5E9E89CB896DBBDE', null],
        'property' => ['FK_8BF21CDE896DBBDE', 'NOW()'],
        'target_group' => ['FK_D16BDFC9896DBBDE', 'NOW()'],
    ];

    public function getDescription(): string
    {
        return 'updated_at and updated_by_id on domain tables';
    }

    public function up(Schema $schema): void
    {
        foreach (self::TABLES as $table => [$fk, $initial]) {
            if (null !== $initial) {
                $this->addSql(sprintf('ALTER TABLE %s ADD updated_at DATETIME DEFAULT NULL', $table));
                $this->addSql(sprintf('UPDATE %s SET updated_at = %s', $table, $initial));
                $this->addSql(sprintf('ALTER TABLE %s MODIFY updated_at DATETIME NOT NULL', $table));
            }
            $this->addSql(sprintf('ALTER TABLE %s ADD updated_by_id VARCHAR(36) DEFAULT NULL', $table));
            $this->addSql(sprintf('ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (updated_by_id) REFERENCES user (id) ON DELETE SET NULL', $table, $fk));
            $this->addSql(sprintf('CREATE INDEX IDX_%s ON %s (updated_by_id)', substr($fk, 3), $table));
        }
    }

    public function down(Schema $schema): void
    {
        foreach (self::TABLES as $table => [$fk, $initial]) {
            $this->addSql(sprintf('ALTER TABLE %s DROP FOREIGN KEY %s', $table, $fk));
            $this->addSql(sprintf('DROP INDEX IDX_%s ON %s', substr($fk, 3), $table));
            $this->addSql(sprintf('ALTER TABLE %s DROP updated_by_id', $table));
            if (null !== $initial) {
                $this->addSql(sprintf('ALTER TABLE %s DROP updated_at', $table));
            }
        }
    }
}
