<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261108120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'oauth_account: tenant_id/object_id (Microsoft tid/oid, stable account key; backfilled on sign-in)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE oauth_account ADD tenant_id VARCHAR(36) DEFAULT NULL, ADD object_id VARCHAR(36) DEFAULT NULL');
        $this->addSql('CREATE UNIQUE INDEX uq_oauth_provider_tenant_object ON oauth_account (provider, tenant_id, object_id)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX uq_oauth_provider_tenant_object ON oauth_account');
        $this->addSql('ALTER TABLE oauth_account DROP tenant_id, DROP object_id');
    }
}
