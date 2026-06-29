<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260629000000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add isEmailVerified/createdAt to user; create email_verification table';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE `user` ADD COLUMN is_email_verified TINYINT(1) NOT NULL DEFAULT 0');
        $this->addSql("ALTER TABLE `user` ADD COLUMN created_at DATETIME NOT NULL DEFAULT NOW() COMMENT '(DC2Type:datetime_immutable)'");
        $this->addSql('UPDATE `user` SET is_email_verified = 1');
        $this->addSql("CREATE TABLE email_verification (
            id VARCHAR(36) NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            token_hash VARCHAR(255) NOT NULL,
            expires_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
            used_at DATETIME DEFAULT NULL COMMENT '(DC2Type:datetime_immutable)',
            invalidated_at DATETIME DEFAULT NULL COMMENT '(DC2Type:datetime_immutable)',
            PRIMARY KEY (id),
            INDEX IDX_email_verification_user_id (user_id),
            CONSTRAINT FK_email_verification_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE email_verification');
        $this->addSql('ALTER TABLE `user` DROP COLUMN is_email_verified, DROP COLUMN created_at');
    }
}
