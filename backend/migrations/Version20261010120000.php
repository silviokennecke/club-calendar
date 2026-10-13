<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261010120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add event.external_uid (UID of an imported ICS event, indexed per calendar for duplicate checks)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE event ADD external_uid VARCHAR(255) DEFAULT NULL');
        $this->addSql('CREATE INDEX idx_event_calendar_external_uid ON event (calendar_id, external_uid)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_event_calendar_external_uid ON event');
        $this->addSql('ALTER TABLE event DROP external_uid');
    }
}
