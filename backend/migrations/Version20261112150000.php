<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261112150000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Security events: store the full raw user agent (forensics, never rendered)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE security_event ADD user_agent VARCHAR(512) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE security_event DROP user_agent');
    }
}
