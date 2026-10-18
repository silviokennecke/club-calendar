<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/** Club invitations (security audit M8): `club_invitation` with a hashed one-time token. */
final class Version20261018120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'club_invitation: invitations by e-mail address with hashed one-time token';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE club_invitation (
            id VARCHAR(36) NOT NULL,
            club_id VARCHAR(36) NOT NULL,
            invited_by_id VARCHAR(36) DEFAULT NULL,
            email VARCHAR(254) NOT NULL,
            token_hash VARCHAR(64) NOT NULL,
            status VARCHAR(10) NOT NULL,
            created_at DATETIME NOT NULL,
            expires_at DATETIME NOT NULL,
            resolved_at DATETIME DEFAULT NULL,
            UNIQUE INDEX uq_club_invitation_token_hash (token_hash),
            INDEX idx_club_invitation_club_email (club_id, email),
            INDEX idx_club_invitation_email_status (email, status),
            INDEX IDX_B8DB2F4FA7B4A7E3 (invited_by_id),
            PRIMARY KEY (id)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB');
        $this->addSql('ALTER TABLE club_invitation ADD CONSTRAINT FK_CLUB_INVITATION_CLUB FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE club_invitation ADD CONSTRAINT FK_CLUB_INVITATION_INVITED_BY FOREIGN KEY (invited_by_id) REFERENCES user (id) ON DELETE SET NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE club_invitation');
    }
}
