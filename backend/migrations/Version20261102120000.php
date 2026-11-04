<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261102120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'oauth_authorization_request: browser_binding_hash (consent cookie binding, null = legacy)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE oauth_authorization_request ADD browser_binding_hash VARCHAR(64) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE oauth_authorization_request DROP browser_binding_hash');
    }
}
