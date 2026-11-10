<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261110140000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'member_subscription.secret holds an encrypted value: widen to 255 (existing plaintext is encrypted by app:secrets:rotate)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE member_subscription MODIFY secret VARCHAR(255) NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE member_subscription MODIFY secret VARCHAR(64) NOT NULL');
    }
}
