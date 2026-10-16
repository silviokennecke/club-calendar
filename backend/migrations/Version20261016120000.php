<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * E-mail confirmation by a 6-digit code instead of a link: `email_verification` holds the (peppered) bcrypt hash of the code,
 * the number of wrong attempts and the send time (resend cooldown, daily caps per account: invalidated rows
 * stay and count). Pending link tokens are useless now and
 * removed.
 */
final class Version20261016120000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'email_verification: attempts, created_at for 6-digit codes; pending link tokens removed';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('DELETE FROM email_verification');
        $this->addSql('ALTER TABLE email_verification ADD attempts INT DEFAULT 0 NOT NULL, ADD created_at DATETIME NOT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE email_verification DROP attempts, DROP created_at');
    }
}
