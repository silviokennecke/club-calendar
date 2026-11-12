<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/** Failure rows get a deterministic key (user, type, method, provider, IP, hour) so folding is enforced by the database. */
final class Version20261112120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Security events: unique dedupe_key for race-free folding of failures';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE security_event ADD dedupe_key CHAR(64) DEFAULT NULL');
        $this->addSql('CREATE UNIQUE INDEX uq_security_event_dedupe_key ON security_event (dedupe_key)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX uq_security_event_dedupe_key ON security_event');
        $this->addSql('ALTER TABLE security_event DROP dedupe_key');
    }
}
