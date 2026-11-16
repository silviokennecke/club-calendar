<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261117100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Index event(location_id, date) for the resource conflict check';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE INDEX idx_event_location_date ON event (location_id, date)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_event_location_date ON event');
    }
}
