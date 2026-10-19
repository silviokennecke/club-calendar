<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Drops the feed setting `calendar_feed.searchable`: a feed is now indexable exactly when its visibility
 * is PUBLIC (CLUB and PRIVATE are never indexed).
 *
 * Behaviour change for existing data: before this migration a PUBLIC feed was indexed only with
 * `searchable = 1`; afterwards ALL PUBLIC feeds are indexable. down() re-adds the column with default 0,
 * so after a rollback no feed is indexable until the option is set again.
 */
final class Version20261021120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Drop calendar_feed.searchable (PUBLIC feeds are indexable)';
    }

    public function up(Schema $schema): void
    {
        if ($this->hasColumn()) {
            $this->addSql('ALTER TABLE calendar_feed DROP searchable');
        }
    }

    public function down(Schema $schema): void
    {
        if (!$this->hasColumn()) {
            $this->addSql('ALTER TABLE calendar_feed ADD searchable TINYINT(1) DEFAULT 0 NOT NULL');
        }
    }

    private function hasColumn(): bool
    {
        return (bool) $this->connection->fetchOne(
            "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'calendar_feed' AND column_name = 'searchable'",
        );
    }
}
