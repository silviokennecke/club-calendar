<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Club roles: `club_user.role` and `club_invitation.role` (viewer|editor|admin). Every existing member becomes an
 * admin, so nobody loses a right on upgrade; new invitations default to editor.
 */
final class Version20261019120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'club_user.role, club_invitation.role (existing members become admins)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE club_user ADD role VARCHAR(10) NOT NULL DEFAULT 'admin'");
        $this->addSql("ALTER TABLE club_invitation ADD role VARCHAR(10) NOT NULL DEFAULT 'editor'");
        // The mapping has no database default: new rows always set the role in PHP.
        $this->addSql('ALTER TABLE club_user ALTER role DROP DEFAULT');
        $this->addSql('ALTER TABLE club_invitation ALTER role DROP DEFAULT');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE club_user DROP role');
        $this->addSql('ALTER TABLE club_invitation DROP role');
    }
}
