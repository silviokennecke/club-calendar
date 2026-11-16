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
    case SitemapRefresh = 'sitemap-refresh';
    case TelemetryHourly = 'telemetry-hourly';
    case TelemetryDaily = 'telemetry-daily';

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
            self::SitemapRefresh => '20 */6 * * *',
            self::TelemetryHourly => '5 * * * *',
            self::TelemetryDaily => '20 3 * * *',
        };
    }

    /** One plain-language line for operators (manual run list and choice). */
    public function description(): string
    {
        return match ($this) {
            self::PruneUnverifiedUsers => 'Delete accounts that never confirmed their address after 30 days',
            self::PrunePasswordResets => 'Delete expired password reset links and e-mail change confirmations',
            self::PruneRefreshTokens => 'Delete expired sessions',
            self::PruneClubInvitations => 'Delete invitations answered or expired more than 30 days ago',
            self::PruneOAuth => 'Delete expired AI app connection entries',
            self::PruneSecurityEvents => 'Delete security log entries older than one year',
            self::PruneAuthNonces => 'Delete expired one-time sign-in values',
            self::PruneFailedMessages => 'Delete failed queue entries older than 30 days',
            self::HolidaysRefresh => 'Refresh the predefined holiday calendars',
            self::GeoIpUpdate => 'Download a newer location database (needs MAXMIND_LICENSE_KEY)',
            self::SitemapRefresh => 'Rebuild the sitemap of public feeds',
            self::TelemetryHourly => 'Report hourly totals to the monitoring system (needs an OTLP endpoint)',
            self::TelemetryDaily => 'Report daily distributions to the monitoring system (needs an OTLP endpoint)',
        };
    }

    /** True for jobs that log and swallow failures by policy, so a run cannot signal them. */
    public function swallowsFailures(): bool
    {
        return match ($this) {
            self::HolidaysRefresh, self::GeoIpUpdate, self::SitemapRefresh, self::TelemetryHourly, self::TelemetryDaily => true,
            default => false,
        };
    }

    public function needsTelemetry(): bool
    {
        return self::TelemetryHourly === $this || self::TelemetryDaily === $this;
    }
}
