<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20260628011709 extends AbstractMigration
{
    public function getDescription(): string
    {
        return '';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE location ADD updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
        $this->addSql("ALTER TABLE location ALTER updated_at DROP DEFAULT");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE location DROP updated_at');
    }
}
