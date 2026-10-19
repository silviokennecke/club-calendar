<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/** Versioned legal documents (imprint, privacy, terms) and the users' consents to them. */
final class Version20261023120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add legal_document and user_consent';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE IF NOT EXISTS legal_document (id VARCHAR(36) NOT NULL, type VARCHAR(16) NOT NULL, content_hash CHAR(64) NOT NULL, markdown MEDIUMTEXT NOT NULL, html MEDIUMTEXT NOT NULL, title VARCHAR(255) DEFAULT NULL, published_at DATETIME NOT NULL, retired_at DATETIME DEFAULT NULL, INDEX idx_legal_document_type_published (type, published_at), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
        $this->addSql('CREATE TABLE IF NOT EXISTS user_consent (id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, document_id VARCHAR(36) NOT NULL, type VARCHAR(16) NOT NULL, consented_at DATETIME NOT NULL, ip_address VARCHAR(45) DEFAULT NULL, user_agent VARCHAR(512) DEFAULT NULL, INDEX IDX_3B1F161AA76ED395 (user_id), INDEX IDX_3B1F161AC33F7837 (document_id), INDEX idx_user_consent_user_document (user_id, document_id), PRIMARY KEY (id), CONSTRAINT FK_user_consent_user FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE, CONSTRAINT FK_user_consent_document FOREIGN KEY (document_id) REFERENCES legal_document (id) ON DELETE RESTRICT) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE IF EXISTS user_consent');
        $this->addSql('DROP TABLE IF EXISTS legal_document');
    }
}
