<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/** Optional plain-text `note` on events and event templates. */
final class Version20261022120000 extends AbstractMigration
{
    private const TABLES = ['event', 'event_template'];

    public function getDescription(): string
    {
        return 'Add note to event and event_template';
    }

    public function up(Schema $schema): void
    {
        foreach (self::TABLES as $table) {
            if (!$this->hasColumn($table)) {
                $this->addSql(sprintf('ALTER TABLE %s ADD note LONGTEXT DEFAULT NULL', $table));
            }
        }
    }

    public function down(Schema $schema): void
    {
        foreach (self::TABLES as $table) {
            if ($this->hasColumn($table)) {
                $this->addSql(sprintf('ALTER TABLE %s DROP note', $table));
            }
        }
    }

    private function hasColumn(string $table): bool
    {
        return (bool) $this->connection->fetchOne(
            "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'note'",
            [$table],
        );
    }
}
