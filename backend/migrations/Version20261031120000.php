<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261031120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'holiday_calendar: type, source (ics|openholidays), source country/subdivision/language, nullable url';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE holiday_calendar ADD type VARCHAR(16) NOT NULL DEFAULT 'other', ADD source VARCHAR(16) NOT NULL DEFAULT 'ics', ADD source_country VARCHAR(8) DEFAULT NULL, ADD source_subdivision VARCHAR(16) DEFAULT NULL, ADD source_language VARCHAR(8) DEFAULT NULL, CHANGE url url VARCHAR(2048) DEFAULT NULL");
    }

    public function down(Schema $schema): void
    {
        $this->addSql("UPDATE holiday_calendar SET url = '' WHERE url IS NULL");
        $this->addSql('ALTER TABLE holiday_calendar DROP type, DROP source, DROP source_country, DROP source_subdivision, DROP source_language, CHANGE url url VARCHAR(2048) NOT NULL');
    }
}
