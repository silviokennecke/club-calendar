<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/** OAuth authorization server and MCP grants: clients, authorization requests and codes, grants, tokens. */
final class Version20261025120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'oauth_client, oauth_authorization_request, oauth_authorization_code, mcp_grant, mcp_token';
    }

    public function up(Schema $schema): void
    {
        $opts = 'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB';
        $this->addSql("CREATE TABLE oauth_client (id VARCHAR(36) NOT NULL, client_name VARCHAR(255) NOT NULL, redirect_uris LONGTEXT NOT NULL, created_at DATETIME NOT NULL, INDEX idx_oauth_client_created_at (created_at), PRIMARY KEY (id)) $opts");
        $this->addSql("CREATE TABLE mcp_grant (id VARCHAR(36) NOT NULL, scopes VARCHAR(100) NOT NULL, created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL, revoked_at DATETIME DEFAULT NULL, last_used_at DATETIME DEFAULT NULL, user_id VARCHAR(36) NOT NULL, client_id VARCHAR(36) NOT NULL, INDEX idx_mcp_grant_user (user_id), INDEX idx_mcp_grant_client (client_id), PRIMARY KEY (id)) $opts");
        $this->addSql("CREATE TABLE oauth_authorization_request (id VARCHAR(36) NOT NULL, redirect_uri VARCHAR(2048) NOT NULL, scopes VARCHAR(100) NOT NULL, code_challenge VARCHAR(128) NOT NULL, state VARCHAR(2048) DEFAULT NULL, resource VARCHAR(2048) NOT NULL, created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL, client_id VARCHAR(36) NOT NULL, INDEX IDX_1AB7621819EB6921 (client_id), INDEX idx_oauth_authorization_request_expires_at (expires_at), PRIMARY KEY (id)) $opts");
        $this->addSql("CREATE TABLE oauth_authorization_code (id VARCHAR(36) NOT NULL, code_hash VARCHAR(64) NOT NULL, redirect_uri VARCHAR(2048) NOT NULL, code_challenge VARCHAR(128) NOT NULL, resource VARCHAR(2048) NOT NULL, created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL, used_at DATETIME DEFAULT NULL, grant_id VARCHAR(36) NOT NULL, INDEX IDX_793B08175C0C89F3 (grant_id), INDEX idx_oauth_authorization_code_expires_at (expires_at), UNIQUE INDEX uq_oauth_authorization_code_hash (code_hash), PRIMARY KEY (id)) $opts");
        $this->addSql("CREATE TABLE mcp_token (id VARCHAR(36) NOT NULL, type VARCHAR(7) NOT NULL, token_hash VARCHAR(64) NOT NULL, created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL, rotated_at DATETIME DEFAULT NULL, last_used_at DATETIME DEFAULT NULL, grant_id VARCHAR(36) NOT NULL, INDEX idx_mcp_token_grant (grant_id), INDEX idx_mcp_token_expires_at (expires_at), UNIQUE INDEX uq_mcp_token_hash (token_hash), PRIMARY KEY (id)) $opts");
        $this->addSql('ALTER TABLE mcp_grant ADD CONSTRAINT FK_BD62E5DA76ED395 FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE mcp_grant ADD CONSTRAINT FK_BD62E5D19EB6921 FOREIGN KEY (client_id) REFERENCES oauth_client (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE oauth_authorization_request ADD CONSTRAINT FK_1AB7621819EB6921 FOREIGN KEY (client_id) REFERENCES oauth_client (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE oauth_authorization_code ADD CONSTRAINT FK_793B08175C0C89F3 FOREIGN KEY (grant_id) REFERENCES mcp_grant (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE mcp_token ADD CONSTRAINT FK_9DE4E92A5C0C89F3 FOREIGN KEY (grant_id) REFERENCES mcp_grant (id) ON DELETE CASCADE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE mcp_token');
        $this->addSql('DROP TABLE oauth_authorization_code');
        $this->addSql('DROP TABLE oauth_authorization_request');
        $this->addSql('DROP TABLE mcp_grant');
        $this->addSql('DROP TABLE oauth_client');
    }
}
