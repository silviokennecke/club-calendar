<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261110120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'club.feed_signup (off|internal|public, existing clubs: internal) and feed_member (feed access of members)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("ALTER TABLE club ADD feed_signup VARCHAR(10) DEFAULT 'internal' NOT NULL");
        $this->addSql('CREATE TABLE feed_member (id VARCHAR(36) NOT NULL, source VARCHAR(10) NOT NULL, created_at DATETIME NOT NULL, feed_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, created_by_id VARCHAR(36) DEFAULT NULL, INDEX IDX_B2C68A8C51A5BC03 (feed_id), INDEX idx_feed_member_user (user_id), INDEX IDX_B2C68A8CB03A8386 (created_by_id), UNIQUE INDEX uq_feed_member_feed_user (feed_id, user_id), PRIMARY KEY (id)) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
        $this->addSql('ALTER TABLE feed_member ADD CONSTRAINT FK_FEED_MEMBER_FEED FOREIGN KEY (feed_id) REFERENCES calendar_feed (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE feed_member ADD CONSTRAINT FK_FEED_MEMBER_USER FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE feed_member ADD CONSTRAINT FK_FEED_MEMBER_CREATOR FOREIGN KEY (created_by_id) REFERENCES user (id) ON DELETE SET NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE feed_member');
        $this->addSql('ALTER TABLE club DROP feed_signup');
    }
}
