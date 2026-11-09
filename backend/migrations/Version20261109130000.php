<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261109130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'club_user(club_id, role) index for the paginated member list';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE INDEX idx_club_user_club_role ON club_user (club_id, role)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_club_user_club_role ON club_user');
    }
}
