<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * E-mail addresses are stored trimmed and lower case; the code no longer relies on the column collation.
 * Lower-cases the existing values. club_invitation.email goes back to the default collation.
 */
final class Version20261030120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'store e-mail addresses normalized (trimmed, lower case)';
    }

    public function up(Schema $schema): void
    {
        $collisions = $this->connection->fetchFirstColumn(
            'SELECT LOWER(TRIM(email)) FROM user GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1',
        );
        $this->abortIf(
            [] !== $collisions,
            'Cannot normalize user.email: these addresses exist more than once apart from case/whitespace, merge or delete the duplicate accounts first: '.implode(', ', $collisions),
        );

        $this->addSql('UPDATE user SET email = LOWER(TRIM(email)) WHERE email <> LOWER(TRIM(email))');
        $this->addSql('UPDATE email_change SET new_email = LOWER(TRIM(new_email)) WHERE new_email <> LOWER(TRIM(new_email))');
        $this->addSql('UPDATE oauth_account SET email = LOWER(TRIM(email)) WHERE email IS NOT NULL AND email <> LOWER(TRIM(email))');
        $this->addSql('UPDATE club_invitation SET email = LOWER(TRIM(email)) WHERE email <> LOWER(TRIM(email))');
        $this->addSql('ALTER TABLE club_invitation MODIFY email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE club_invitation MODIFY email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL');
    }
}
