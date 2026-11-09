<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261109120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'user: OPAQUE record, version and key id (nullable, additive; bcrypt password stays)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE user ADD opaque_record VARBINARY(256) DEFAULT NULL, ADD opaque_version SMALLINT DEFAULT NULL, ADD opaque_key_id VARCHAR(16) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE user DROP opaque_record, DROP opaque_version, DROP opaque_key_id');
    }
}
