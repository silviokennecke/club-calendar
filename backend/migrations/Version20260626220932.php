<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
final class Version20260626220932 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add HolidayCalendar and HolidayEvent tables';
    }

    public function up(Schema $schema): void
    {
        // this up() migration is auto-generated, please modify it to your needs
        $this->addSql('CREATE TABLE holiday_calendar (id INT AUTO_INCREMENT NOT NULL, name VARCHAR(255) NOT NULL, url VARCHAR(2048) NOT NULL, last_fetched_at DATETIME DEFAULT NULL, calendar_id VARCHAR(36) NOT NULL, INDEX IDX_89235104A40A2C8 (calendar_id), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        $this->addSql('CREATE TABLE holiday_event (id INT AUTO_INCREMENT NOT NULL, uid VARCHAR(500) NOT NULL, name VARCHAR(255) NOT NULL, date DATE NOT NULL, date_end DATE DEFAULT NULL, holiday_calendar_id INT NOT NULL, INDEX IDX_12143560608F7002 (holiday_calendar_id), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        $this->addSql('ALTER TABLE holiday_calendar ADD CONSTRAINT FK_89235104A40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE holiday_event ADD CONSTRAINT FK_12143560608F7002 FOREIGN KEY (holiday_calendar_id) REFERENCES holiday_calendar (id) ON DELETE CASCADE');
    }

    public function down(Schema $schema): void
    {
        // this down() migration is auto-generated, please modify it to your needs
        $this->addSql('ALTER TABLE holiday_calendar DROP FOREIGN KEY FK_89235104A40A2C8');
        $this->addSql('ALTER TABLE holiday_event DROP FOREIGN KEY FK_12143560608F7002');
        $this->addSql('DROP TABLE holiday_calendar');
        $this->addSql('DROP TABLE holiday_event');
    }
}
