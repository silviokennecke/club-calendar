<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261004130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add user.token_version (raising it ends all sessions issued before)';
    }

    public function up(Schema $schema): void
    {
        // Default 0 = the version that tokens without a "tv" claim count as: sessions issued before this
        // migration stay valid until the account's credentials are revoked.
        $this->addSql('ALTER TABLE `user` ADD token_version INT DEFAULT 0 NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE `user` DROP token_version');
    }
}
