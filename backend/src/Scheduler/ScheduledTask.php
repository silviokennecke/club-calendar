<?php

declare(strict_types=1);

namespace App\Scheduler;

enum ScheduledTask: string
{
    case PruneUnverifiedUsers = 'prune-unverified-users';
    case PrunePasswordResets = 'prune-password-resets';
    case PruneRefreshTokens = 'prune-refresh-tokens';
    case PruneClubInvitations = 'prune-club-invitations';
    case PruneOAuth = 'prune-oauth';
    case PruneSecurityEvents = 'prune-security-events';
    case PruneAuthNonces = 'prune-auth-nonces';
    case PruneFailedMessages = 'prune-failed-messages';
    case HolidaysRefresh = 'holidays-refresh';
    case GeoIpUpdate = 'geoip-update';

    /** Fixed UTC cron expression; daily jobs are staggered between 02:00 and 04:00, the fetching jobs run on Sundays. */
    public function cron(): string
    {
        return match ($this) {
            self::PruneUnverifiedUsers => '0 2 * * *',
            self::PrunePasswordResets => '10 2 * * *',
            self::PruneRefreshTokens => '20 2 * * *',
            self::PruneClubInvitations => '30 2 * * *',
            self::PruneOAuth => '40 2 * * *',
            self::PruneSecurityEvents => '50 2 * * *',
            self::PruneAuthNonces => '0 3 * * *',
            self::PruneFailedMessages => '10 3 * * *',
            self::HolidaysRefresh => '30 3 * * 0',
            self::GeoIpUpdate => '50 3 * * 0',
        };
    }
}
