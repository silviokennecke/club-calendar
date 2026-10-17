<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Refresh tokens are stored and rotated: `refresh_token` holds one row per issued token (id = jti) with its
 * session (`family_id`), the absolute end of the session, and rotation / revocation times.
 */
final class Version20261017120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'refresh_token: server-side refresh tokens with families, rotation and revocation';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE refresh_token (
            id VARCHAR(36) NOT NULL,
            family_id VARCHAR(36) NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            issued_at DATETIME NOT NULL,
            expires_at DATETIME NOT NULL,
            family_expires_at DATETIME NOT NULL,
            rotated_at DATETIME DEFAULT NULL,
            revoked_at DATETIME DEFAULT NULL,
            INDEX idx_refresh_token_family (family_id),
            INDEX idx_refresh_token_user (user_id),
            INDEX idx_refresh_token_family_expires_at (family_expires_at),
            PRIMARY KEY (id)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB');
        $this->addSql('ALTER TABLE refresh_token ADD CONSTRAINT FK_C74F2195A76ED395 FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE refresh_token');
    }
}
