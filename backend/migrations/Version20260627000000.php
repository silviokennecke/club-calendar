<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260627000000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Migrate HolidayCalendar and HolidayEvent IDs from INT to UUID (VARCHAR 36)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE holiday_event DROP FOREIGN KEY FK_12143560608F7002');
        $this->addSql('ALTER TABLE holiday_calendar MODIFY id VARCHAR(36) NOT NULL');
        $this->addSql('ALTER TABLE holiday_event MODIFY id VARCHAR(36) NOT NULL, MODIFY holiday_calendar_id VARCHAR(36) NOT NULL');
        $this->addSql('ALTER TABLE holiday_event ADD CONSTRAINT FK_12143560608F7002 FOREIGN KEY (holiday_calendar_id) REFERENCES holiday_calendar (id) ON DELETE CASCADE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE holiday_event DROP FOREIGN KEY FK_12143560608F7002');
        $this->addSql('ALTER TABLE holiday_calendar MODIFY id INT NOT NULL AUTO_INCREMENT');
        $this->addSql('ALTER TABLE holiday_event MODIFY id INT NOT NULL AUTO_INCREMENT, MODIFY holiday_calendar_id INT NOT NULL');
        $this->addSql('ALTER TABLE holiday_event ADD CONSTRAINT FK_12143560608F7002 FOREIGN KEY (holiday_calendar_id) REFERENCES holiday_calendar (id) ON DELETE CASCADE');
    }
}
