<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;
use Symfony\Component\Uid\Uuid;

/** calendar.content_version: token that changes with every change of the calendar's feed output (see ContentVersionListener). */
final class Version20261028120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'calendar.content_version';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE calendar ADD content_version VARCHAR(36) DEFAULT NULL');
    }

    public function postUp(Schema $schema): void
    {
        foreach ($this->connection->fetchFirstColumn('SELECT id FROM calendar') as $id) {
            $this->connection->executeStatement('UPDATE calendar SET content_version = ? WHERE id = ?', [Uuid::v7()->toRfc4122(), $id]);
        }
        $this->connection->executeStatement('ALTER TABLE calendar MODIFY content_version VARCHAR(36) NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE calendar DROP content_version');
    }
}
