<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260628000000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add language column to user table (default en for existing users)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE `user` ADD COLUMN language VARCHAR(10) NOT NULL DEFAULT 'en'");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE `user` DROP COLUMN language');
    }
}
