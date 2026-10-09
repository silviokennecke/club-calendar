<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261009120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Make event_template.timezone, time_begin and time_end optional (templates without times create all-day events)';
    }

    public function up(Schema $schema): void
    {
        // Only relaxes NOT NULL; existing rows keep their values.
        $this->addSql('ALTER TABLE event_template CHANGE timezone timezone VARCHAR(100) DEFAULT NULL, CHANGE time_begin time_begin VARCHAR(5) DEFAULT NULL, CHANGE time_end time_end VARCHAR(5) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        // Templates without times get the former form defaults back before NOT NULL is restored.
        $this->addSql("UPDATE event_template SET timezone = 'Europe/Berlin' WHERE timezone IS NULL");
        $this->addSql("UPDATE event_template SET time_begin = '19:00' WHERE time_begin IS NULL");
        $this->addSql("UPDATE event_template SET time_end = '21:00' WHERE time_end IS NULL");
        $this->addSql('ALTER TABLE event_template CHANGE timezone timezone VARCHAR(100) NOT NULL, CHANGE time_begin time_begin VARCHAR(5) NOT NULL, CHANGE time_end time_end VARCHAR(5) NOT NULL');
    }
}
