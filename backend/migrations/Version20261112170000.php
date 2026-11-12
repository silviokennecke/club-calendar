<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261112170000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Step-up: stored, single-use mailed confirmation codes';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE step_up_code (id VARCHAR(36) NOT NULL, code_hash VARCHAR(64) NOT NULL, expires_at DATETIME NOT NULL, created_at DATETIME NOT NULL, user_id VARCHAR(36) NOT NULL, UNIQUE INDEX uq_step_up_code_user (user_id), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci`');
        $this->addSql('ALTER TABLE step_up_code ADD CONSTRAINT FK_STEP_UP_CODE_USER FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE step_up_code');
    }
}
