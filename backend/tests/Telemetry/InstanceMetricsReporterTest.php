<?php

declare(strict_types=1);

namespace App\Tests\Telemetry;

use App\Enum\ClubRole;
use App\Enum\FeedVisibility;
use App\Telemetry\InstanceMetricsReporter;
use App\Telemetry\Telemetry;
use App\Telemetry\TelemetryConfig;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use OpenTelemetry\SDK\Metrics\MetricExporter\InMemoryExporter;
use Psr\Log\NullLogger;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

final class InstanceMetricsReporterTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private Connection $db;
    private \ArrayObject $storage;
    private InstanceMetricsReporter $reporter;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->db = $this->em->getConnection();

        $config = new TelemetryConfig('http://x');
        $this->storage = new \ArrayObject();
        $telemetry = new Telemetry($config, null, new InMemoryExporter($this->storage, $config->temporality));
        $this->reporter = new InstanceMetricsReporter($this->db, $telemetry, new NullLogger(), new \App\Telemetry\LoginMetrics($telemetry));
    }

    /** @return list<array{array<string, mixed>, int|float}> */
    private function points(string $name): array
    {
        $out = [];
        foreach ($this->storage as $metric) {
            if ($metric->name !== $name) {
                continue;
            }
            foreach ($metric->data->dataPoints as $p) {
                $out[] = [$p->attributes->toArray(), $p->value];
            }
        }

        return $out;
    }

    /** @return array<string, int|float> attribute value => value */
    private function by(string $name, string $attr): array
    {
        $out = [];
        foreach ($this->points($name) as [$attrs, $value]) {
            $out[var_export($attrs[$attr], true)] = $value;
        }
        ksort($out);

        return $out;
    }

    private function seed(): void
    {
        $hasher = self::getContainer()->get(UserPasswordHasherInterface::class);
        $a = TestHelper::createUser($this->em, $hasher);
        $b = TestHelper::createUser($this->em, $hasher, null, 'password123', false);
        $c = TestHelper::createUser($this->em, $hasher);
        $club1 = TestHelper::createClub($this->em, $a);
        TestHelper::addMember($this->em, $club1, $b, ClubRole::MEMBER);
        $club2 = TestHelper::createClub($this->em, $a, 'Two');
        TestHelper::addMember($this->em, $club2, $c, ClubRole::VIEWER);
        $cal1 = TestHelper::createCalendar($this->em, $club1);
        $cal2 = TestHelper::createCalendar($this->em, $club1, 'Old');
        $cal2->setArchivedAt(new \DateTimeImmutable());
        $cal3 = TestHelper::createCalendar($this->em, $club2);
        TestHelper::createEvent($this->em, $cal1, ['isDraft' => true]);
        TestHelper::createEvent($this->em, $cal1, ['isDraft' => false]);
        TestHelper::createFeed($this->em, $club1, [$cal1, $cal2], FeedVisibility::PUBLIC);
        TestHelper::createFeed($this->em, $club2, [$cal3], FeedVisibility::PRIVATE);
        $this->em->flush();
    }

    public function testHourlyTotals(): void
    {
        $this->seed();
        $this->reporter->reportHourly();

        self::assertSame(['false' => 1, 'true' => 2], $this->by('club_calendar.users', 'verified'));
        self::assertSame(2, $this->points('club_calendar.clubs')[0][1]);
        self::assertSame(['false' => 2, 'true' => 1], $this->by('club_calendar.calendars', 'archived'));
        self::assertSame(['false' => 1, 'true' => 1], $this->by('club_calendar.events', 'draft'));
        self::assertSame(['club' => 0, 'private' => 1, 'public' => 1], array_map('intval', $this->stringKeyed('club_calendar.feeds', 'visibility')));
        self::assertSame(['admin' => 2, 'editor' => 0, 'member' => 1, 'viewer' => 1], $this->stringKeyed('club_calendar.memberships', 'role'));
        self::assertSame(['members' => 0, 'staff' => 0], $this->stringKeyed('club_calendar.resources', 'visibility'));
        self::assertSame(0, $this->points('club_calendar.calendar_members')[0][1]);
        self::assertSame(0, $this->points('club_calendar.mcp.grants')[0][1]);
        self::assertSame(0, $this->points('club_calendar.member_subscriptions')[0][1]);
        self::assertSame(0, $this->points('club_calendar.mcp.clients')[0][1]);
    }

    public function testHourlyCreatesZeroLoginSeries(): void
    {
        $this->reporter->reportHourly();

        $points = $this->points('club_calendar.logins');
        self::assertCount(16, $points);
        foreach ($points as [, $value]) {
            self::assertSame(0, $value);
        }
        $keys = array_map(static fn (array $p): string => implode('/', [$p[0]['method'], $p[0]['stage'], var_export($p[0]['success'], true), $p[0]['provider'] ?? '']), $points);
        self::assertContains('passkey/primary/true/', $keys);
        self::assertContains('sso/primary/false/none', $keys);
        self::assertContains('backup_code/mfa/true/', $keys);
    }

    /** @return array<string, int|float> */
    private function stringKeyed(string $name, string $attr): array
    {
        $out = [];
        foreach ($this->points($name) as [$attrs, $value]) {
            $out[$attrs[$attr]] = $value;
        }
        ksort($out);

        return $out;
    }

    public function testDailyDistributions(): void
    {
        $this->seed();
        $this->reporter->reportDaily();

        $viewer = [];
        foreach ($this->points('club_calendar.club.members') as [$a, $v]) {
            if ('viewer' === $a['role']) {
                $viewer[$a['stat']] = $v;
            }
        }
        self::assertEqualsWithDelta(['avg' => 0.5, 'max' => 1.0, 'median' => 0.5, 'min' => 0.0, 'stddev' => 0.5], $this->sorted($viewer), 1e-9);
        $all = array_filter($this->points('club_calendar.club.members'), static fn (array $p): bool => 'all' === $p[0]['role'] && 'avg' === $p[0]['stat']);
        self::assertSame(2.0, array_values($all)[0][1]);

        $events = $this->stringKeyed('club_calendar.calendar.events', 'stat');
        self::assertEqualsWithDelta(2 / 3, $events['avg'], 1e-9);
        self::assertSame(0.0, $events['min']);
        self::assertSame(2.0, $events['max']);
        self::assertSame(0.0, $events['median']);

        self::assertSame(1.0, $this->stringKeyed('club_calendar.club.calendars', 'stat')['max']);
        self::assertSame(1.0, $this->stringKeyed('club_calendar.club.feeds', 'stat')['avg']);
        $fc = $this->stringKeyed('club_calendar.feed.calendars', 'stat');
        self::assertSame(1.5, $fc['avg']);
        self::assertSame(1.5, $fc['median']);
        self::assertSame(2.0, $fc['max']);
        self::assertCount(5, $fc);
    }

    /** @param array<string, float> $a @return array<string, float> */
    private function sorted(array $a): array
    {
        ksort($a);

        return $a;
    }

    public function testDailyWithoutDataRecordsNothing(): void
    {
        $this->reporter->reportDaily();
        self::assertSame([], $this->points('club_calendar.club.members'));
        self::assertSame([], $this->points('club_calendar.calendar.events'));
    }

    public function testDisabledRunsNoQueries(): void
    {
        $db = $this->createMock(Connection::class);
        $db->expects(self::never())->method(self::anything());
        $telemetry = new Telemetry(new TelemetryConfig(''));
        $reporter = new InstanceMetricsReporter($db, $telemetry, new NullLogger());
        $reporter->reportHourly();
        $reporter->reportDaily();
    }

    public function testFailuresAreSwallowedAndLoggedWithClassOnly(): void
    {
        $db = $this->createStub(Connection::class);
        $db->method('fetchAllAssociative')->willThrowException(new \RuntimeException('secret'));
        $db->method('fetchFirstColumn')->willThrowException(new \RuntimeException('secret'));
        $logger = new class extends \Psr\Log\AbstractLogger {
            public array $records = [];

            public function log($level, \Stringable|string $message, array $context = []): void
            {
                $this->records[] = $context;
            }
        };
        $config = new TelemetryConfig('http://x');
        $reporter = new InstanceMetricsReporter($db, new Telemetry($config, null, new InMemoryExporter(new \ArrayObject())), $logger);
        $reporter->reportHourly();
        $reporter->reportDaily();
        self::assertSame([['exception' => \RuntimeException::class], ['exception' => \RuntimeException::class]], $logger->records);
    }
}
