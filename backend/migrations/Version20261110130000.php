<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261110130000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'member_subscription (personal club subscription) with its feed and target group selection';
    }

    public function up(Schema $schema): void
    {
        $opts = 'DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB';
        $this->addSql("CREATE TABLE member_subscription (id VARCHAR(36) NOT NULL, secret VARCHAR(64) NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, club_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, updated_by_id VARCHAR(36) DEFAULT NULL, INDEX IDX_D675FA5B61190A32 (club_id), INDEX IDX_D675FA5B896DBBDE (updated_by_id), INDEX idx_member_subscription_user (user_id), UNIQUE INDEX uq_member_subscription_club_user (club_id, user_id), PRIMARY KEY (id)) $opts");
        $this->addSql("CREATE TABLE member_subscription_feed (subscription_id VARCHAR(36) NOT NULL, feed_id VARCHAR(36) NOT NULL, INDEX IDX_5D25F48B9A1887DC (subscription_id), INDEX IDX_5D25F48B51A5BC03 (feed_id), PRIMARY KEY (subscription_id, feed_id)) $opts");
        $this->addSql("CREATE TABLE member_subscription_target_group (subscription_id VARCHAR(36) NOT NULL, target_group_id VARCHAR(36) NOT NULL, INDEX IDX_16B332789A1887DC (subscription_id), INDEX IDX_16B3327824FF092E (target_group_id), PRIMARY KEY (subscription_id, target_group_id)) $opts");
        $this->addSql('ALTER TABLE member_subscription ADD CONSTRAINT FK_D675FA5B61190A32 FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE member_subscription ADD CONSTRAINT FK_D675FA5BA76ED395 FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE member_subscription ADD CONSTRAINT FK_D675FA5B896DBBDE FOREIGN KEY (updated_by_id) REFERENCES user (id) ON DELETE SET NULL');
        $this->addSql('ALTER TABLE member_subscription_feed ADD CONSTRAINT FK_5D25F48B9A1887DC FOREIGN KEY (subscription_id) REFERENCES member_subscription (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE member_subscription_feed ADD CONSTRAINT FK_5D25F48B51A5BC03 FOREIGN KEY (feed_id) REFERENCES calendar_feed (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE member_subscription_target_group ADD CONSTRAINT FK_16B332789A1887DC FOREIGN KEY (subscription_id) REFERENCES member_subscription (id) ON DELETE CASCADE');
        $this->addSql('ALTER TABLE member_subscription_target_group ADD CONSTRAINT FK_16B3327824FF092E FOREIGN KEY (target_group_id) REFERENCES target_group (id) ON DELETE CASCADE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE member_subscription_target_group');
        $this->addSql('DROP TABLE member_subscription_feed');
        $this->addSql('DROP TABLE member_subscription');
    }
}
