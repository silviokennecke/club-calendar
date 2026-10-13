<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261014120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Event series: table event_series (rule) and event.series_id (ON DELETE SET NULL, indexed)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE event_series (
            id VARCHAR(36) NOT NULL,
            calendar_id VARCHAR(36) NOT NULL,
            template_id VARCHAR(36) DEFAULT NULL,
            frequency VARCHAR(16) NOT NULL,
            weekday SMALLINT NOT NULL,
            nth SMALLINT DEFAULT NULL,
            start_date DATE NOT NULL,
            until_date DATE DEFAULT NULL,
            occurrences INT DEFAULT NULL,
            skip_holidays TINYINT(1) NOT NULL,
            duration_days SMALLINT NOT NULL,
            created_at DATETIME NOT NULL,
            INDEX IDX_889767FA40A2C8 (calendar_id),
            INDEX IDX_889767F5DA0FB8 (template_id),
            PRIMARY KEY (id)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB');
        $this->addSql('ALTER TABLE event_series ADD CONSTRAINT FK_889767FA40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE event_series ADD CONSTRAINT FK_889767F5DA0FB8 FOREIGN KEY (template_id) REFERENCES event_template (id) ON DELETE SET NULL');

        $this->addSql('ALTER TABLE event ADD series_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('CREATE INDEX idx_event_series ON event (series_id)');
        $this->addSql('ALTER TABLE event ADD CONSTRAINT FK_3BAE0AA75278319C FOREIGN KEY (series_id) REFERENCES event_series (id) ON DELETE SET NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE event DROP FOREIGN KEY FK_3BAE0AA75278319C');
        $this->addSql('DROP INDEX idx_event_series ON event');
        $this->addSql('ALTER TABLE event DROP series_id');
        $this->addSql('DROP TABLE event_series');
    }
}
