<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261013120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Accounts: password_reset and email_change (hashed one-time tokens), passkey.last_used_at, club_user.last_calendar_id';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE password_reset (
            id VARCHAR(36) NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            token_hash VARCHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            used_at DATETIME DEFAULT NULL,
            created_at DATETIME NOT NULL,
            UNIQUE INDEX uq_password_reset_token_hash (token_hash),
            INDEX idx_password_reset_expires_at (expires_at),
            INDEX IDX_B1017252A76ED395 (user_id),
            PRIMARY KEY (id)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB');
        $this->addSql('ALTER TABLE password_reset ADD CONSTRAINT FK_B1017252A76ED395 FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');

        $this->addSql('CREATE TABLE email_change (
            id VARCHAR(36) NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            new_email VARCHAR(255) NOT NULL,
            token_hash VARCHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            used_at DATETIME DEFAULT NULL,
            created_at DATETIME NOT NULL,
            UNIQUE INDEX uq_email_change_token_hash (token_hash),
            INDEX idx_email_change_expires_at (expires_at),
            INDEX IDX_3DCD2DD0A76ED395 (user_id),
            PRIMARY KEY (id)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB');
        $this->addSql('ALTER TABLE email_change ADD CONSTRAINT FK_3DCD2DD0A76ED395 FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');

        $this->addSql('ALTER TABLE passkey ADD last_used_at DATETIME DEFAULT NULL');
        $this->addSql('ALTER TABLE club_user ADD last_calendar_id VARCHAR(36) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE club_user DROP last_calendar_id');
        $this->addSql('ALTER TABLE passkey DROP last_used_at');
        $this->addSql('DROP TABLE email_change');
        $this->addSql('DROP TABLE password_reset');
    }
}
