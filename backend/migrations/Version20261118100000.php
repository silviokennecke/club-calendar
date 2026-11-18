<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261118100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'event.type (event|notice, existing rows: event)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE event ADD type VARCHAR(16) DEFAULT 'event' NOT NULL");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE event DROP type');
    }
}
