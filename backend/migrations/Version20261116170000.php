<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261116170000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Resources: bookable locations with visibility, double-booking flag and buffer';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE resource (id VARCHAR(36) NOT NULL, type VARCHAR(20) NOT NULL, name VARCHAR(255) NOT NULL, visibility VARCHAR(20) NOT NULL, allow_double_booking TINYINT NOT NULL, buffer_minutes INT NOT NULL, updated_at DATETIME NOT NULL, club_id VARCHAR(36) NOT NULL, location_id VARCHAR(36) NOT NULL, updated_by_id VARCHAR(36) DEFAULT NULL, INDEX IDX_BC91F41661190A32 (club_id), INDEX IDX_BC91F416896DBBDE (updated_by_id), UNIQUE INDEX uq_resource_location (location_id), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci`');
        $this->addSql('ALTER TABLE resource ADD CONSTRAINT FK_RESOURCE_CLUB FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE resource ADD CONSTRAINT FK_RESOURCE_LOCATION FOREIGN KEY (location_id) REFERENCES location (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE resource ADD CONSTRAINT FK_RESOURCE_UPDATED_BY FOREIGN KEY (updated_by_id) REFERENCES user (id) ON DELETE SET NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE resource');
    }
}
