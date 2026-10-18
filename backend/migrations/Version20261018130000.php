<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * `club_invitation.email` compares binary (utf8mb4_bin): the address is stored normalized (trimmed, lower case) in
 * PHP, and SQL matches must be as strict as the PHP comparison (utf8mb4_unicode_ci would equate "josé" and "jose").
 */
final class Version20261018130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'club_invitation.email: binary collation (strict address matching)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE club_invitation MODIFY email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE club_invitation MODIFY email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL');
    }
}
