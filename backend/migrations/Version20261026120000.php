<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/** The matched MCP_ALLOWED_CLIENTS family of an OAuth client. */
final class Version20261026120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'oauth_client.family';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE oauth_client ADD family VARCHAR(20) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE oauth_client DROP family');
    }
}
