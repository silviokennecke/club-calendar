<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260625000000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Initial schema — full club calendar database';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE `user` (
            id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            password VARCHAR(255) DEFAULT NULL,
            date_format VARCHAR(20) NOT NULL DEFAULT \'dd.MM.yyyy\',
            first_day_of_week INT NOT NULL DEFAULT 1,
            last_club_id VARCHAR(36) DEFAULT NULL,
            last_calendar_id VARCHAR(36) DEFAULT NULL,
            UNIQUE INDEX UNIQ_8D93D649E7927C74 (email),
            PRIMARY KEY(id)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE club (
            id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            timezone VARCHAR(100) NOT NULL DEFAULT \'Europe/Berlin\',
            PRIMARY KEY(id)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE club_user (
            club_id VARCHAR(36) NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            PRIMARY KEY(club_id, user_id),
            INDEX IDX_E95B1CA961190A32 (club_id),
            INDEX IDX_E95B1CA9A76ED395 (user_id),
            CONSTRAINT FK_E95B1CA961190A32 FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE,
            CONSTRAINT FK_E95B1CA9A76ED395 FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE calendar (
            id VARCHAR(36) NOT NULL,
            club_id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            timezone VARCHAR(100) DEFAULT NULL,
            archived_at DATETIME DEFAULT NULL,
            INDEX IDX_6EA9A14661190A32 (club_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_6EA9A14661190A32 FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE calendar_feed (
            id VARCHAR(36) NOT NULL,
            calendar_id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            visibility VARCHAR(255) NOT NULL DEFAULT \'PRIVATE\',
            shared_secret VARCHAR(255) NOT NULL,
            INDEX IDX_71D6C7FFA40A2C8 (calendar_id),
            UNIQUE INDEX UNIQ_71D6C7FF3F5AEAD1 (shared_secret),
            PRIMARY KEY(id),
            CONSTRAINT FK_71D6C7FFA40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE target_group (
            id VARCHAR(36) NOT NULL,
            calendar_id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            INDEX IDX_D16BDFC9A40A2C8 (calendar_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_D16BDFC9A40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE calendar_feed_target_group (
            feed_id VARCHAR(36) NOT NULL,
            target_group_id VARCHAR(36) NOT NULL,
            PRIMARY KEY(feed_id, target_group_id),
            INDEX IDX_6C83CC0751A5BC03 (feed_id),
            INDEX IDX_6C83CC0724FF092E (target_group_id),
            CONSTRAINT FK_6C83CC0751A5BC03 FOREIGN KEY (feed_id) REFERENCES calendar_feed (id) ON DELETE CASCADE,
            CONSTRAINT FK_6C83CC0724FF092E FOREIGN KEY (target_group_id) REFERENCES target_group (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE property (
            id VARCHAR(36) NOT NULL,
            calendar_id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            icon VARCHAR(32) DEFAULT NULL,
            INDEX IDX_8BF21CDEA40A2C8 (calendar_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_8BF21CDEA40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE feature (
            id VARCHAR(36) NOT NULL,
            calendar_id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            INDEX IDX_1FD77566A40A2C8 (calendar_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_1FD77566A40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE location (
            id VARCHAR(36) NOT NULL,
            calendar_id VARCHAR(36) NOT NULL,
            name VARCHAR(255) DEFAULT NULL,
            street VARCHAR(255) DEFAULT NULL,
            zip VARCHAR(20) DEFAULT NULL,
            city VARCHAR(255) DEFAULT NULL,
            country VARCHAR(100) DEFAULT NULL,
            latitude DOUBLE PRECISION DEFAULT NULL,
            longitude DOUBLE PRECISION DEFAULT NULL,
            INDEX IDX_5E9E89CBA40A2C8 (calendar_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_5E9E89CBA40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_template (
            id VARCHAR(36) NOT NULL,
            calendar_id VARCHAR(36) NOT NULL,
            location_id VARCHAR(36) DEFAULT NULL,
            name VARCHAR(255) NOT NULL,
            timezone VARCHAR(100) NOT NULL,
            time_begin VARCHAR(5) NOT NULL,
            time_end VARCHAR(5) NOT NULL,
            INDEX IDX_D18CF653A40A2C8 (calendar_id),
            INDEX IDX_D18CF65364D218E (location_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_D18CF653A40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE,
            CONSTRAINT FK_D18CF65364D218E FOREIGN KEY (location_id) REFERENCES location (id) ON DELETE SET NULL
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_template_property (
            template_id VARCHAR(36) NOT NULL,
            property_id VARCHAR(36) NOT NULL,
            PRIMARY KEY(template_id, property_id),
            INDEX IDX_413D76CC5DA0FB8 (template_id),
            INDEX IDX_413D76CC549213EC (property_id),
            CONSTRAINT FK_413D76CC5DA0FB8 FOREIGN KEY (template_id) REFERENCES event_template (id) ON DELETE CASCADE,
            CONSTRAINT FK_413D76CC549213EC FOREIGN KEY (property_id) REFERENCES property (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_template_feature (
            template_id VARCHAR(36) NOT NULL,
            feature_id VARCHAR(36) NOT NULL,
            PRIMARY KEY(template_id, feature_id),
            INDEX IDX_6A7FED975DA0FB8 (template_id),
            INDEX IDX_6A7FED9760E4B879 (feature_id),
            CONSTRAINT FK_6A7FED975DA0FB8 FOREIGN KEY (template_id) REFERENCES event_template (id) ON DELETE CASCADE,
            CONSTRAINT FK_6A7FED9760E4B879 FOREIGN KEY (feature_id) REFERENCES feature (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_template_target_group (
            template_id VARCHAR(36) NOT NULL,
            target_group_id VARCHAR(36) NOT NULL,
            PRIMARY KEY(template_id, target_group_id),
            INDEX IDX_59E8EE045DA0FB8 (template_id),
            INDEX IDX_59E8EE0424FF092E (target_group_id),
            CONSTRAINT FK_59E8EE045DA0FB8 FOREIGN KEY (template_id) REFERENCES event_template (id) ON DELETE CASCADE,
            CONSTRAINT FK_59E8EE0424FF092E FOREIGN KEY (target_group_id) REFERENCES target_group (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE `event` (
            id VARCHAR(36) NOT NULL,
            calendar_id VARCHAR(36) NOT NULL,
            event_template_id VARCHAR(36) DEFAULT NULL,
            location_id VARCHAR(36) DEFAULT NULL,
            name VARCHAR(255) NOT NULL,
            timezone VARCHAR(100) DEFAULT NULL,
            date DATE NOT NULL,
            date_end DATE DEFAULT NULL,
            time_begin VARCHAR(5) NOT NULL,
            time_end VARCHAR(5) NOT NULL,
            is_all_day TINYINT(1) NOT NULL DEFAULT 0,
            is_draft TINYINT(1) NOT NULL DEFAULT 1,
            INDEX IDX_3BAE0AA7A40A2C8 (calendar_id),
            INDEX IDX_3BAE0AA7AE53DC38 (event_template_id),
            INDEX IDX_3BAE0AA764D218E (location_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_3BAE0AA7A40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE,
            CONSTRAINT FK_3BAE0AA7AE53DC38 FOREIGN KEY (event_template_id) REFERENCES event_template (id) ON DELETE SET NULL,
            CONSTRAINT FK_3BAE0AA764D218E FOREIGN KEY (location_id) REFERENCES location (id) ON DELETE SET NULL
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_property (
            event_id VARCHAR(36) NOT NULL,
            property_id VARCHAR(36) NOT NULL,
            PRIMARY KEY(event_id, property_id),
            INDEX IDX_CD1EF50E71F7E88B (event_id),
            INDEX IDX_CD1EF50E549213EC (property_id),
            CONSTRAINT FK_CD1EF50E71F7E88B FOREIGN KEY (event_id) REFERENCES `event` (id) ON DELETE CASCADE,
            CONSTRAINT FK_CD1EF50E549213EC FOREIGN KEY (property_id) REFERENCES property (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_feature (
            event_id VARCHAR(36) NOT NULL,
            feature_id VARCHAR(36) NOT NULL,
            PRIMARY KEY(event_id, feature_id),
            INDEX IDX_9A80DCC971F7E88B (event_id),
            INDEX IDX_9A80DCC960E4B879 (feature_id),
            CONSTRAINT FK_9A80DCC971F7E88B FOREIGN KEY (event_id) REFERENCES `event` (id) ON DELETE CASCADE,
            CONSTRAINT FK_9A80DCC960E4B879 FOREIGN KEY (feature_id) REFERENCES feature (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_target_group (
            event_id VARCHAR(36) NOT NULL,
            target_group_id VARCHAR(36) NOT NULL,
            PRIMARY KEY(event_id, target_group_id),
            INDEX IDX_3C78D53A71F7E88B (event_id),
            INDEX IDX_3C78D53A24FF092E (target_group_id),
            CONSTRAINT FK_3C78D53A71F7E88B FOREIGN KEY (event_id) REFERENCES `event` (id) ON DELETE CASCADE,
            CONSTRAINT FK_3C78D53A24FF092E FOREIGN KEY (target_group_id) REFERENCES target_group (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE passkey (
            id VARCHAR(255) NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            credential_id VARCHAR(700) NOT NULL,
            public_key LONGBLOB NOT NULL,
            counter BIGINT NOT NULL DEFAULT 0,
            device_name VARCHAR(255) DEFAULT NULL,
            created_at DATETIME NOT NULL,
            INDEX IDX_85347CA76ED395 (user_id),
            UNIQUE INDEX UNIQ_85347C2558A7A5 (credential_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_85347CA76ED395 FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE oauth_account (
            id VARCHAR(36) NOT NULL,
            user_id VARCHAR(36) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            provider_id VARCHAR(255) NOT NULL,
            email VARCHAR(255) DEFAULT NULL,
            INDEX IDX_6E30F9D1A76ED395 (user_id),
            UNIQUE INDEX uq_oauth_provider_provider_id (provider, provider_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_6E30F9D1A76ED395 FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('SET FOREIGN_KEY_CHECKS=0');
        $this->addSql('DROP TABLE oauth_account');
        $this->addSql('DROP TABLE passkey');
        $this->addSql('DROP TABLE event_target_group');
        $this->addSql('DROP TABLE event_feature');
        $this->addSql('DROP TABLE event_property');
        $this->addSql('DROP TABLE event');
        $this->addSql('DROP TABLE event_template_target_group');
        $this->addSql('DROP TABLE event_template_feature');
        $this->addSql('DROP TABLE event_template_property');
        $this->addSql('DROP TABLE event_template');
        $this->addSql('DROP TABLE location');
        $this->addSql('DROP TABLE feature');
        $this->addSql('DROP TABLE property');
        $this->addSql('DROP TABLE calendar_feed_target_group');
        $this->addSql('DROP TABLE target_group');
        $this->addSql('DROP TABLE calendar_feed');
        $this->addSql('DROP TABLE calendar');
        $this->addSql('DROP TABLE club_user');
        $this->addSql('DROP TABLE club');
        $this->addSql('DROP TABLE `user`');
        $this->addSql('SET FOREIGN_KEY_CHECKS=1');
    }
}
