<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261117120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Calendar members: per-calendar permissions for club members';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE calendar_member (id VARCHAR(36) NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, calendar_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, created_by_id VARCHAR(36) DEFAULT NULL, updated_by_id VARCHAR(36) DEFAULT NULL, INDEX IDX_DA82E224A40A2C8 (calendar_id), INDEX idx_calendar_member_user (user_id), INDEX IDX_DA82E224B03A8386 (created_by_id), INDEX IDX_DA82E224896DBBDE (updated_by_id), UNIQUE INDEX uq_calendar_member_calendar_user (calendar_id, user_id), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci`');
        $this->addSql('ALTER TABLE calendar_member ADD CONSTRAINT FK_CALMEMBER_CALENDAR FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE calendar_member ADD CONSTRAINT FK_CALMEMBER_USER FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE calendar_member ADD CONSTRAINT FK_CALMEMBER_CREATED_BY FOREIGN KEY (created_by_id) REFERENCES user (id) ON DELETE SET NULL');
        $this->addSql('ALTER TABLE calendar_member ADD CONSTRAINT FK_CALMEMBER_UPDATED_BY FOREIGN KEY (updated_by_id) REFERENCES user (id) ON DELETE SET NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE calendar_member');
    }
}
