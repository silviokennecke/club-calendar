<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261111210000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'MFA: user.mfa_enforced, user_totp, mfa_backup_code and security_event';
    }

    public function up(Schema $schema): void
    {
        $opts = 'DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB';
        $this->addSql('ALTER TABLE user ADD mfa_enforced TINYINT DEFAULT 0 NOT NULL, ADD mfa_enforced_at DATETIME DEFAULT NULL');
        $this->addSql("CREATE TABLE user_totp (id VARCHAR(36) NOT NULL, secret VARCHAR(255) NOT NULL, created_at DATETIME NOT NULL, last_used_step BIGINT DEFAULT NULL, user_id VARCHAR(36) NOT NULL, UNIQUE INDEX uq_user_totp_user (user_id), PRIMARY KEY (id)) $opts");
        $this->addSql("CREATE TABLE mfa_backup_code (id VARCHAR(36) NOT NULL, code_hash CHAR(64) NOT NULL, created_at DATETIME NOT NULL, used_at DATETIME DEFAULT NULL, user_id VARCHAR(36) NOT NULL, INDEX idx_mfa_backup_code_user (user_id), UNIQUE INDEX uq_mfa_backup_code_hash (code_hash), PRIMARY KEY (id)) $opts");
        $this->addSql("CREATE TABLE security_event (id VARCHAR(36) NOT NULL, type VARCHAR(40) NOT NULL, method VARCHAR(30) DEFAULT NULL, provider VARCHAR(40) DEFAULT NULL, success TINYINT NOT NULL, attempts SMALLINT UNSIGNED DEFAULT 1 NOT NULL, ip VARCHAR(45) DEFAULT NULL, city VARCHAR(100) DEFAULT NULL, country CHAR(2) DEFAULT NULL, browser VARCHAR(100) DEFAULT NULL, created_at DATETIME NOT NULL, user_id VARCHAR(36) NOT NULL, INDEX IDX_D712E90DA76ED395 (user_id), INDEX idx_security_event_user_created (user_id, created_at), INDEX idx_security_event_created (created_at), INDEX idx_security_event_dedupe (user_id, type, success, created_at), PRIMARY KEY (id)) $opts");
        $this->addSql('ALTER TABLE user_totp ADD CONSTRAINT FK_E745E5CDA76ED395 FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE mfa_backup_code ADD CONSTRAINT FK_7E432D9A76ED395 FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE security_event ADD CONSTRAINT FK_D712E90DA76ED395 FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE security_event');
        $this->addSql('DROP TABLE mfa_backup_code');
        $this->addSql('DROP TABLE user_totp');
        $this->addSql('ALTER TABLE user DROP mfa_enforced, DROP mfa_enforced_at');
    }
}
