<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Three feed states: PUBLIC, CLUB (new default), PRIVATE, plus the search engine opt-in `searchable`.
 *
 * `calendar_feed.visibility` is a VARCHAR(255) (Doctrine enumType, no DB ENUM), so the new value needs no
 * column type change. Existing data: PUBLIC → CLUB (reachable by link as before, now noindex); PRIVATE
 * stays PRIVATE (the secret stays required). Down maps CLUB → PUBLIC and drops `searchable`.
 */
final class Version20261015120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Feed states PUBLIC/CLUB/PRIVATE (existing PUBLIC → CLUB, PRIVATE stays), calendar_feed.searchable';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE calendar_feed ADD searchable TINYINT(1) DEFAULT 0 NOT NULL');
        $this->addSql("ALTER TABLE calendar_feed ALTER visibility SET DEFAULT 'CLUB'");
        $this->addSql("UPDATE calendar_feed SET visibility = 'CLUB' WHERE visibility = 'PUBLIC'");
    }

    public function down(Schema $schema): void
    {
        $this->addSql("UPDATE calendar_feed SET visibility = 'PUBLIC' WHERE visibility = 'CLUB'");
        $this->addSql("ALTER TABLE calendar_feed ALTER visibility SET DEFAULT 'PRIVATE'");
        $this->addSql('ALTER TABLE calendar_feed DROP searchable');
    }
}
