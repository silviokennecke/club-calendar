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
            id INT AUTO_INCREMENT NOT NULL,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            password VARCHAR(255) DEFAULT NULL,
            date_format VARCHAR(20) NOT NULL DEFAULT \'dd.MM.yyyy\',
            first_day_of_week INT NOT NULL DEFAULT 1,
            last_club_id INT DEFAULT NULL,
            last_calendar_id INT DEFAULT NULL,
            UNIQUE INDEX UNIQ_8D93D649E7927C74 (email),
            PRIMARY KEY(id)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE club (
            id INT AUTO_INCREMENT NOT NULL,
            name VARCHAR(255) NOT NULL,
            timezone VARCHAR(100) NOT NULL DEFAULT \'Europe/Berlin\',
            PRIMARY KEY(id)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE club_user (
            club_id INT NOT NULL,
            user_id INT NOT NULL,
            PRIMARY KEY(club_id, user_id),
            INDEX IDX_CB5EC09261190A32 (club_id),
            INDEX IDX_CB5EC092A76ED395 (user_id),
            CONSTRAINT FK_CB5EC09261190A32 FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE,
            CONSTRAINT FK_CB5EC092A76ED395 FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE calendar (
            id INT AUTO_INCREMENT NOT NULL,
            club_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            timezone VARCHAR(100) DEFAULT NULL,
            archived_at DATETIME DEFAULT NULL,
            INDEX IDX_6EA9A14661190A32 (club_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_6EA9A14661190A32 FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE calendar_feed (
            id INT AUTO_INCREMENT NOT NULL,
            calendar_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            visibility VARCHAR(255) NOT NULL DEFAULT \'PRIVATE\',
            shared_secret VARCHAR(255) NOT NULL,
            INDEX IDX_DB1F4AA0A40A2C8 (calendar_id),
            UNIQUE INDEX UNIQ_DB1F4AA0D57C9A2C (shared_secret),
            PRIMARY KEY(id),
            CONSTRAINT FK_DB1F4AA0A40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE target_group (
            id INT AUTO_INCREMENT NOT NULL,
            calendar_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            INDEX IDX_2BAB25D0A40A2C8 (calendar_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_2BAB25D0A40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE calendar_feed_target_group (
            feed_id INT NOT NULL,
            target_group_id INT NOT NULL,
            PRIMARY KEY(feed_id, target_group_id),
            INDEX IDX_8E33FE5651A5BC03 (feed_id),
            INDEX IDX_8E33FE56BE4B15E8 (target_group_id),
            CONSTRAINT FK_8E33FE5651A5BC03 FOREIGN KEY (feed_id) REFERENCES calendar_feed (id) ON DELETE CASCADE,
            CONSTRAINT FK_8E33FE56BE4B15E8 FOREIGN KEY (target_group_id) REFERENCES target_group (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE property (
            id INT AUTO_INCREMENT NOT NULL,
            calendar_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            icon VARCHAR(32) DEFAULT NULL,
            INDEX IDX_8BF21CDEA40A2C8 (calendar_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_8BF21CDEA40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE feature (
            id INT AUTO_INCREMENT NOT NULL,
            calendar_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            INDEX IDX_1FD77566A40A2C8 (calendar_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_1FD77566A40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE location (
            id INT AUTO_INCREMENT NOT NULL,
            calendar_id INT NOT NULL,
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
            id INT AUTO_INCREMENT NOT NULL,
            calendar_id INT NOT NULL,
            location_id INT DEFAULT NULL,
            name VARCHAR(255) NOT NULL,
            timezone VARCHAR(100) NOT NULL,
            time_begin VARCHAR(5) NOT NULL,
            time_end VARCHAR(5) NOT NULL,
            INDEX IDX_F308758CA40A2C8 (calendar_id),
            INDEX IDX_F308758C64D218E (location_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_F308758CA40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE,
            CONSTRAINT FK_F308758C64D218E FOREIGN KEY (location_id) REFERENCES location (id) ON DELETE SET NULL
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_template_property (
            template_id INT NOT NULL,
            property_id INT NOT NULL,
            PRIMARY KEY(template_id, property_id),
            INDEX IDX_9BAA4A075DA0FB8 (template_id),
            INDEX IDX_9BAA4A07549213EC (property_id),
            CONSTRAINT FK_9BAA4A075DA0FB8 FOREIGN KEY (template_id) REFERENCES event_template (id) ON DELETE CASCADE,
            CONSTRAINT FK_9BAA4A07549213EC FOREIGN KEY (property_id) REFERENCES property (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_template_feature (
            template_id INT NOT NULL,
            feature_id INT NOT NULL,
            PRIMARY KEY(template_id, feature_id),
            INDEX IDX_4D7F1F685DA0FB8 (template_id),
            INDEX IDX_4D7F1F6860E4B879 (feature_id),
            CONSTRAINT FK_4D7F1F685DA0FB8 FOREIGN KEY (template_id) REFERENCES event_template (id) ON DELETE CASCADE,
            CONSTRAINT FK_4D7F1F6860E4B879 FOREIGN KEY (feature_id) REFERENCES feature (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_template_target_group (
            template_id INT NOT NULL,
            target_group_id INT NOT NULL,
            PRIMARY KEY(template_id, target_group_id),
            INDEX IDX_D8EA63F65DA0FB8 (template_id),
            INDEX IDX_D8EA63F6BE4B15E8 (target_group_id),
            CONSTRAINT FK_D8EA63F65DA0FB8 FOREIGN KEY (template_id) REFERENCES event_template (id) ON DELETE CASCADE,
            CONSTRAINT FK_D8EA63F6BE4B15E8 FOREIGN KEY (target_group_id) REFERENCES target_group (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event (
            id INT AUTO_INCREMENT NOT NULL,
            calendar_id INT NOT NULL,
            event_template_id INT DEFAULT NULL,
            location_id INT DEFAULT NULL,
            name VARCHAR(255) NOT NULL,
            timezone VARCHAR(100) DEFAULT NULL,
            date DATE NOT NULL,
            date_end DATE DEFAULT NULL,
            time_begin VARCHAR(5) NOT NULL,
            time_end VARCHAR(5) NOT NULL,
            is_all_day TINYINT(1) NOT NULL DEFAULT 0,
            is_draft TINYINT(1) NOT NULL DEFAULT 1,
            INDEX IDX_3BAE0AA7A40A2C8 (calendar_id),
            INDEX IDX_3BAE0AA79B3A1D45 (event_template_id),
            INDEX IDX_3BAE0AA764D218E (location_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_3BAE0AA7A40A2C8 FOREIGN KEY (calendar_id) REFERENCES calendar (id) ON DELETE CASCADE,
            CONSTRAINT FK_3BAE0AA79B3A1D45 FOREIGN KEY (event_template_id) REFERENCES event_template (id) ON DELETE SET NULL,
            CONSTRAINT FK_3BAE0AA764D218E FOREIGN KEY (location_id) REFERENCES location (id) ON DELETE SET NULL
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_property (
            event_id INT NOT NULL,
            property_id INT NOT NULL,
            PRIMARY KEY(event_id, property_id),
            INDEX IDX_2D17EA3E71F7E88B (event_id),
            INDEX IDX_2D17EA3E549213EC (property_id),
            CONSTRAINT FK_2D17EA3E71F7E88B FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE CASCADE,
            CONSTRAINT FK_2D17EA3E549213EC FOREIGN KEY (property_id) REFERENCES property (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_feature (
            event_id INT NOT NULL,
            feature_id INT NOT NULL,
            PRIMARY KEY(event_id, feature_id),
            INDEX IDX_9B4B2BC671F7E88B (event_id),
            INDEX IDX_9B4B2BC660E4B879 (feature_id),
            CONSTRAINT FK_9B4B2BC671F7E88B FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE CASCADE,
            CONSTRAINT FK_9B4B2BC660E4B879 FOREIGN KEY (feature_id) REFERENCES feature (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE event_target_group (
            event_id INT NOT NULL,
            target_group_id INT NOT NULL,
            PRIMARY KEY(event_id, target_group_id),
            INDEX IDX_3EAD5EC871F7E88B (event_id),
            INDEX IDX_3EAD5EC8BE4B15E8 (target_group_id),
            CONSTRAINT FK_3EAD5EC871F7E88B FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE CASCADE,
            CONSTRAINT FK_3EAD5EC8BE4B15E8 FOREIGN KEY (target_group_id) REFERENCES target_group (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE passkey (
            id VARCHAR(255) NOT NULL,
            user_id INT NOT NULL,
            credential_id VARCHAR(700) NOT NULL,
            public_key LONGBLOB NOT NULL,
            counter BIGINT NOT NULL DEFAULT 0,
            device_name VARCHAR(255) DEFAULT NULL,
            created_at DATETIME NOT NULL COMMENT \'(DC2Type:datetime_immutable)\',
            INDEX IDX_EA968FD2A76ED395 (user_id),
            UNIQUE INDEX UNIQ_EA968FD23A6E43E5 (credential_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_EA968FD2A76ED395 FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB');

        $this->addSql('CREATE TABLE oauth_account (
            id INT AUTO_INCREMENT NOT NULL,
            user_id INT NOT NULL,
            provider VARCHAR(50) NOT NULL,
            provider_id VARCHAR(255) NOT NULL,
            email VARCHAR(255) DEFAULT NULL,
            INDEX IDX_D2F0A7B7A76ED395 (user_id),
            UNIQUE INDEX UNIQ_D2F0A7B7A53A8AA92FE2B0A (provider, provider_id),
            PRIMARY KEY(id),
            CONSTRAINT FK_D2F0A7B7A76ED395 FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
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
