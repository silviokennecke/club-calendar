<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261004120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create auth_nonce table (one-time WebAuthn challenges and OAuth states)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE auth_nonce (
            id VARCHAR(36) NOT NULL,
            nonce_hash VARCHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            UNIQUE INDEX uq_auth_nonce_hash (nonce_hash),
            INDEX idx_auth_nonce_expires_at (expires_at),
            PRIMARY KEY (id)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE auth_nonce');
    }
}
