<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261101120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'event_series: holiday_calendar_ids (JSON, null = all holiday calendars)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE event_series ADD holiday_calendar_ids JSON DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE event_series DROP holiday_calendar_ids');
    }
}
