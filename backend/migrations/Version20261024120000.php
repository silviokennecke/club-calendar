<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/** Legal documents can be an external link (`url`) instead of Markdown. */
final class Version20261024120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add legal_document.url';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE legal_document ADD url VARCHAR(2048) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE legal_document DROP url');
    }
}
