<?php

declare(strict_types=1);

namespace App\Tests\Helper;

use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Filesystem\Filesystem;

class DatabaseResetter
{
    /**
     * Truncate all application tables and clear the EM identity map.
     *
     * @throws \Doctrine\DBAL\Exception
     */
    public static function reset(EntityManagerInterface $em): void
    {
        $conn = $em->getConnection();
        $tables = [
            'event_target_group', 'event_feature', 'event_property',
            'event', 'event_series',
            'event_template_target_group', 'event_template_feature', 'event_template_property',
            'event_template',
            'calendar_feed_target_group', 'calendar_feed_calendar', 'calendar_feed',
            'target_group', 'location', 'feature', 'property',
            'holiday_event', 'holiday_calendar',
            'calendar', 'club_invitation', 'club_user', 'passkey', 'oauth_account', 'club',
            'oauth_authorization_code', 'oauth_authorization_request', 'mcp_token', 'mcp_grant', 'oauth_client',
            'email_verification', 'password_reset', 'email_change', 'refresh_token', 'user_consent', 'legal_document', 'user', 'auth_nonce',
        ];

        $conn->executeStatement('SET FOREIGN_KEY_CHECKS=0');
        foreach ($tables as $table) {
            $conn->executeStatement("TRUNCATE TABLE `$table`");
        }
        $conn->executeStatement('SET FOREIGN_KEY_CHECKS=1');

        // Auth rate limiter state (config/packages/test/rate_limiter.yaml): every test starts with empty buckets.
        $dir = dirname(__DIR__, 2).'/var/test-auth-limiter';
        if (is_dir($dir)) {
            (new Filesystem())->remove($dir);
        }

        // Clear the entity manager identity map to avoid stale references
        $em->clear();
    }
}
