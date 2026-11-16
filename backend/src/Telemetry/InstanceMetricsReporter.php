<?php

declare(strict_types=1);

namespace App\Telemetry;

use App\Enum\ClubRole;
use App\Enum\FeedVisibility;
use Doctrine\DBAL\Connection;
use Psr\Cache\CacheItemPoolInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Lock\LockFactory;

/**
 * Instance metrics computed by the scheduler (hourly totals and login deltas, daily distributions) and pushed
 * through Telemetry. Disabled telemetry returns before any query; failures are logged and never fail the job.
 */
class InstanceMetricsReporter
{
    public const WATERMARK_KEY = 'telemetry.security_events.watermark';
    private const FIRST_WINDOW = 3600;
    private const MAX_WINDOW = 86400;

    public function __construct(
        private readonly Connection $connection,
        private readonly Telemetry $telemetry,
        private readonly ClockInterface $clock,
        #[Autowire(service: 'scheduler_state')]
        private readonly CacheItemPoolInterface $state,
        #[Autowire(service: 'app.scheduler_lock_factory')]
        private readonly LockFactory $lockFactory,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function reportHourly(): void
    {
        if (!$this->telemetry->isEnabled()) {
            return;
        }
        try {
            $this->recordTotals();
            $this->recordSecurityEvents();
            $this->telemetry->flush();
        } catch (\Throwable $e) {
            $this->logger->warning('Scheduled telemetry report failed.', ['exception' => $e::class]);
        }
    }

    public function reportDaily(): void
    {
        if (!$this->telemetry->isEnabled()) {
            return;
        }
        try {
            $this->recordDistributions();
            $this->telemetry->flush();
        } catch (\Throwable $e) {
            $this->logger->warning('Scheduled telemetry report failed.', ['exception' => $e::class]);
        }
    }

    private function recordTotals(): void
    {
        $t = $this->telemetry;

        $gauge = $t->gauge('club_calendar.users', '{user}', 'Registered users');
        foreach ($this->grouped('SELECT is_email_verified AS k, COUNT(*) AS n FROM `user` GROUP BY is_email_verified', ['0', '1']) as $k => $n) {
            $gauge->record($n, ['verified' => '1' === (string) $k]);
        }

        $t->gauge('club_calendar.clubs', '{club}', 'Clubs')->record($this->scalar('SELECT COUNT(*) FROM club'));

        $gauge = $t->gauge('club_calendar.calendars', '{calendar}', 'Calendars');
        $archived = $this->scalar('SELECT COUNT(*) FROM calendar WHERE archived_at IS NOT NULL');
        $gauge->record($archived, ['archived' => true]);
        $gauge->record($this->scalar('SELECT COUNT(*) FROM calendar') - $archived, ['archived' => false]);

        $gauge = $t->gauge('club_calendar.events', '{event}', 'Events');
        foreach ($this->grouped('SELECT is_draft AS k, COUNT(*) AS n FROM event GROUP BY is_draft', ['0', '1']) as $k => $n) {
            $gauge->record($n, ['draft' => '1' === (string) $k]);
        }

        $gauge = $t->gauge('club_calendar.feeds', '{feed}', 'Calendar feeds');
        foreach ($this->grouped('SELECT visibility AS k, COUNT(*) AS n FROM calendar_feed GROUP BY visibility', array_map(static fn (FeedVisibility $v): string => $v->value, FeedVisibility::cases())) as $k => $n) {
            $gauge->record($n, ['visibility' => strtolower((string) $k)]);
        }

        $t->gauge('club_calendar.member_subscriptions', '{subscription}', 'Personal subscriptions')
            ->record($this->scalar('SELECT COUNT(*) FROM member_subscription'));
        $t->gauge('club_calendar.mcp.grants', '{grant}', 'Active MCP grants (not revoked)')
            ->record($this->scalar('SELECT COUNT(*) FROM mcp_grant WHERE revoked_at IS NULL'));
        $t->gauge('club_calendar.mcp.clients', '{client}', 'Registered OAuth clients')
            ->record($this->scalar('SELECT COUNT(*) FROM oauth_client'));

        $gauge = $t->gauge('club_calendar.club_members', '{member}', 'Club memberships per role');
        foreach ($this->grouped('SELECT role AS k, COUNT(*) AS n FROM club_user GROUP BY role', ClubRole::values()) as $k => $n) {
            $gauge->record($n, ['role' => (string) $k]);
        }
    }

    /**
     * Counts security_event rows in (watermark, now]. The watermark is kept in the shared scheduler state (DB)
     * and a lock keeps concurrent runs from reading the same window. Failure rows are folded by the logger
     * (created_at = first failure of the hour), so failures counted up after a window closed are not reported.
     */
    private function recordSecurityEvents(): void
    {
        $lock = $this->lockFactory->createLock('telemetry_security_events');
        if (!$lock->acquire()) {
            return;
        }
        try {
            $now = $this->clock->now()->getTimestamp();
            $item = $this->state->getItem(self::WATERMARK_KEY);
            $from = $item->isHit() ? (int) $item->get() : $now - self::FIRST_WINDOW;
            $from = max($from, $now - self::MAX_WINDOW);
            if ($from >= $now) {
                return;
            }
            $fmt = static fn (int $ts): string => gmdate('Y-m-d H:i:s', $ts);

            $rows = $this->connection->fetchAllAssociative(
                "SELECT type, method, success, COALESCE(SUM(attempts), 0) AS n FROM security_event
                 WHERE type IN ('login', 'mfa_verify') AND created_at > ? AND created_at <= ?
                 GROUP BY type, method, success",
                [$fmt($from), $fmt($now)],
            );
            $logins = $this->telemetry->counter('club_calendar.logins', '{login}', 'Sign-in attempts');
            $mfa = $this->telemetry->counter('club_calendar.mfa_verifications', '{verification}', 'MFA verification attempts');
            foreach ($rows as $r) {
                $counter = 'login' === $r['type'] ? $logins : $mfa;
                $counter->add((int) $r['n'], ['method' => $r['method'] ?? 'unknown', 'success' => (bool) $r['success']]);
            }

            $item->set($now);
            $this->state->save($item);
        } finally {
            $lock->release();
        }
    }

    private function recordDistributions(): void
    {
        $clubIds = $this->connection->fetchFirstColumn('SELECT id FROM club');
        $perRole = array_fill_keys($clubIds, array_fill_keys(ClubRole::values(), 0));
        foreach ($this->connection->fetchAllAssociative('SELECT club_id, role, COUNT(*) AS n FROM club_user GROUP BY club_id, role') as $r) {
            if (isset($perRole[$r['club_id']][$r['role']])) {
                $perRole[$r['club_id']][$r['role']] = (int) $r['n'];
            }
        }
        $gauge = $this->telemetry->gauge('club_calendar.club.members', '{member}', 'Members per club');
        foreach (ClubRole::values() as $role) {
            $this->recordStats($gauge, array_column($perRole, $role), ['role' => $role]);
        }
        $this->recordStats($gauge, array_map('array_sum', $perRole), ['role' => 'all']);

        $this->recordStats(
            $this->telemetry->gauge('club_calendar.club.calendars', '{calendar}', 'Non-archived calendars per club'),
            $this->counts('SELECT COUNT(cal.id) FROM club c LEFT JOIN calendar cal ON cal.club_id = c.id AND cal.archived_at IS NULL GROUP BY c.id'),
        );
        $this->recordStats(
            $this->telemetry->gauge('club_calendar.calendar.events', '{event}', 'Events per calendar'),
            $this->counts('SELECT COUNT(e.id) FROM calendar cal LEFT JOIN event e ON e.calendar_id = cal.id GROUP BY cal.id'),
        );
        $this->recordStats(
            $this->telemetry->gauge('club_calendar.club.feeds', '{feed}', 'Feeds per club'),
            $this->counts('SELECT COUNT(f.id) FROM club c LEFT JOIN calendar_feed f ON f.club_id = c.id GROUP BY c.id'),
        );
        $this->recordStats(
            $this->telemetry->gauge('club_calendar.feed.calendars', '{calendar}', 'Calendars per feed'),
            $this->counts('SELECT COUNT(fc.calendar_id) FROM calendar_feed f LEFT JOIN calendar_feed_calendar fc ON fc.feed_id = f.id GROUP BY f.id'),
        );
    }

    /** @param list<int|float> $values @param array<string, string> $attributes */
    private function recordStats(\OpenTelemetry\API\Metrics\GaugeInterface $gauge, array $values, array $attributes = []): void
    {
        $stats = DistributionStats::of(array_values($values));
        if (null === $stats) {
            return;
        }
        foreach ($stats->byStat() as $stat => $value) {
            $gauge->record($value, $attributes + ['stat' => $stat]);
        }
    }

    /** @return list<int> */
    private function counts(string $sql): array
    {
        return array_map('intval', $this->connection->fetchFirstColumn($sql));
    }

    private function scalar(string $sql): int
    {
        return (int) $this->connection->fetchOne($sql);
    }

    /**
     * @param list<string> $keys keys that are always reported, 0 when the table has no such row
     *
     * @return array<string, int>
     */
    private function grouped(string $sql, array $keys): array
    {
        $out = array_fill_keys($keys, 0);
        foreach ($this->connection->fetchAllAssociative($sql) as $r) {
            $out[(string) $r['k']] = (int) $r['n'];
        }

        return $out;
    }
}
