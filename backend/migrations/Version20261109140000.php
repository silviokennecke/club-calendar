<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261109140000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'user: marker of the last OPAQUE cutoff reminder mailed (nullable, additive)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE user ADD opaque_reminder_days SMALLINT DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE user DROP opaque_reminder_days');
    }
}
