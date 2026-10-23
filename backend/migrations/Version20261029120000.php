<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/** event: composite index for the feed queries (calendar, draft flag, date range, time order). */
final class Version20261029120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'composite index on event for feed queries';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE INDEX idx_event_calendar_draft_date_time ON event (calendar_id, is_draft, date, time_begin)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_event_calendar_draft_date_time ON event');
    }
}
