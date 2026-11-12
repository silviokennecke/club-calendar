<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Backup codes move from unsalted SHA-256 to a salted bcrypt hash (hasher `backup_code`). Existing SHA-256 rows
 * cannot be converted (the codes are not stored), so they are deleted: accounts with two-step sign-in keep
 * `mfa_enforced` and their TOTP/passkeys, but have no backup codes until the user regenerates them in the profile.
 */
final class Version20261112090000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'MFA: backup codes stored with a salted slow hash (old rows deleted)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('DELETE FROM mfa_backup_code');
        $this->addSql('CREATE INDEX idx_mfa_backup_code_user_used ON mfa_backup_code (user_id, used_at)');
        $this->addSql('DROP INDEX uq_mfa_backup_code_hash ON mfa_backup_code');
        $this->addSql('DROP INDEX idx_mfa_backup_code_user ON mfa_backup_code');
        $this->addSql('ALTER TABLE mfa_backup_code CHANGE code_hash code_hash VARCHAR(255) NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DELETE FROM mfa_backup_code');
        $this->addSql('CREATE INDEX idx_mfa_backup_code_user ON mfa_backup_code (user_id)');
        $this->addSql('DROP INDEX idx_mfa_backup_code_user_used ON mfa_backup_code');
        $this->addSql('ALTER TABLE mfa_backup_code CHANGE code_hash code_hash CHAR(64) NOT NULL');
        $this->addSql('CREATE UNIQUE INDEX uq_mfa_backup_code_hash ON mfa_backup_code (code_hash)');
    }
}
