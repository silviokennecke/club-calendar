<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\ClubInvitation;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Service\EventService;
use App\Service\Input;
use App\Service\Quota;
use App\Service\SeriesRule;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Quotas and input limits (security audit M7): 422 `quota_exceeded` with `resource` and `limit`, the
 * event list window/paging and the caps of id lists and `from-template` dates.
 */
class QuotaTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$em = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    /** @return array{auth: string, user: User, club: Club, calendar: Calendar, base: string} */
    private function setup1(): array
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);

        return [
            'auth' => TestHelper::authHeader($user, self::$tokens), 'user' => $user, 'club' => $club, 'calendar' => $cal,
            'base' => "/api/calendars/{$cal->getId()}",
        ];
    }

    private function req(string $method, string $uri, string $auth, array $data = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $data, $auth);
    }

    /**
     * Adds `$n` copies of the one existing row of the calendar (new id, unique name/secret) in one statement.
     */
    private function fill(string $table, string $ownerId, int $n, string $ownerColumn = 'calendar_id'): void
    {
        $conn = self::$em->getConnection();
        $seed = $conn->fetchAssociative("SELECT * FROM `$table` WHERE `$ownerColumn` = ? LIMIT 1", [$ownerId]);
        $this->assertNotFalse($seed, "no seed row in $table");
        $columns = [];
        $values = [];
        foreach (array_keys($seed) as $column) {
            $columns[] = "`$column`";
            $values[] = match ($column) {
                'id', 'shared_secret' => 'UUID()',
                'name' => "CONCAT('fill ', seq.n)",
                default => "s.`$column`",
            };
        }
        $conn->executeStatement('SET SESSION cte_max_recursion_depth = 100000');
        $conn->executeStatement(sprintf(
            "INSERT INTO `$table` (%s) WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < %d) SELECT %s FROM seq JOIN `$table` s ON s.id = ?",
            implode(',', $columns), $n, implode(',', $values),
        ), [$seed['id']]);
    }

    private function assertQuota(array $r, string $resource, int $limit): void
    {
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('quota_exceeded', $r['body']['code']);
        $this->assertSame($resource, $r['body']['resource']);
        $this->assertSame($limit, $r['body']['limit']);
    }

    private function eventBody(array $extra = []): array
    {
        return $extra + ['name' => 'Termin', 'date' => '2026-10-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00'];
    }

    // --- quotas ---

    public function testClubsPerUser(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $limit = Quota::LIMITS[Quota::CLUBS_PER_USER];
        for ($i = 0; $i < $limit; ++$i) {
            $club = new Club();
            $club->setName("Club $i");
            $club->setTimezone('Europe/Berlin');
            self::$em->persist($club);
            self::$em->persist((new ClubUser())->setClub($club)->setUser($user));
        }
        self::$em->flush();

        $this->assertQuota($this->req('POST', '/api/clubs', $auth, ['name' => 'Eins zu viel', 'timezone' => 'Europe/Berlin']), Quota::CLUBS_PER_USER, $limit);
    }

    public function testCalendarsPerClubAlsoForDuplicate(): void
    {
        ['auth' => $auth, 'club' => $club, 'calendar' => $cal] = $this->setup1();
        $limit = Quota::LIMITS[Quota::CALENDARS_PER_CLUB];
        for ($i = 1; $i < $limit; ++$i) {
            $c = new Calendar();
            $c->setClub($club);
            $c->setName("Kalender $i");
            self::$em->persist($c);
        }
        self::$em->flush();

        $r = $this->req('POST', "/api/clubs/{$club->getId()}/calendars", $auth, ['name' => 'Zu viel']);
        $this->assertQuota($r, Quota::CALENDARS_PER_CLUB, $limit);
        $r = $this->req('POST', "/api/clubs/{$club->getId()}/calendars/{$cal->getId()}/duplicate", $auth, ['name' => 'Kopie']);
        $this->assertQuota($r, Quota::CALENDARS_PER_CLUB, $limit);
    }

    public function testMembersPerClub(): void
    {
        ['club' => $club, 'user' => $owner] = $this->setup1();
        $limit = Quota::LIMITS[Quota::MEMBERS_PER_CLUB];
        $extra = TestHelper::createUser(self::$em, self::$hasher, 'extra@example.com');
        for ($i = 1; $i < $limit; ++$i) {
            $u = (new User())->setName("M $i")->setEmail("m$i@example.com")->setPassword('x')->setIsEmailVerified(true);
            self::$em->persist($u);
            self::$em->persist((new ClubUser())->setClub($club)->setUser($u));
        }
        self::$em->persist(new ClubInvitation($club, $owner, 'extra@example.com', str_repeat('a', 64), new \DateTimeImmutable()));
        self::$em->flush();
        $invitation = self::$em->getRepository(ClubInvitation::class)->findOneBy([]);

        // The invitation is accepted by the user who would be the 501st member
        $r = $this->req('POST', "/api/invitations/{$invitation->getId()}/accept", TestHelper::authHeader($extra, self::$tokens));
        $this->assertQuota($r, Quota::MEMBERS_PER_CLUB, $limit);
    }

    public function testClubsPerUserAlsoWhenAcceptingAnInvitation(): void
    {
        ['club' => $club, 'user' => $owner] = $this->setup1();
        $user = TestHelper::createUser(self::$em, self::$hasher, 'collector@example.com');
        $limit = Quota::LIMITS[Quota::CLUBS_PER_USER];
        for ($i = 0; $i < $limit; ++$i) {
            $c = new Club();
            $c->setName("Club $i");
            $c->setTimezone('Europe/Berlin');
            self::$em->persist($c);
            self::$em->persist((new ClubUser())->setClub($c)->setUser($user));
        }
        $invitation = new ClubInvitation($club, $owner, 'collector@example.com', str_repeat('b', 64), new \DateTimeImmutable());
        self::$em->persist($invitation);
        self::$em->flush();

        $r = $this->req('POST', "/api/invitations/{$invitation->getId()}/accept", TestHelper::authHeader($user, self::$tokens));
        $this->assertQuota($r, Quota::CLUBS_PER_USER, $limit);
    }

    public function testPendingInvitationsPerClub(): void
    {
        ['auth' => $auth, 'club' => $club, 'user' => $user] = $this->setup1();
        $limit = Quota::LIMITS[Quota::PENDING_INVITATIONS_PER_CLUB];
        for ($i = 0; $i < $limit; ++$i) {
            self::$em->persist(new ClubInvitation($club, $user, "p$i@example.com", hash('sha256', "t$i"), new \DateTimeImmutable()));
        }
        // Answered invitations do not count
        $done = new ClubInvitation($club, $user, 'done@example.com', hash('sha256', 'done'), new \DateTimeImmutable());
        $done->resolve(ClubInvitation::DECLINED, new \DateTimeImmutable());
        self::$em->persist($done);
        self::$em->flush();

        $r = $this->req('POST', "/api/clubs/{$club->getId()}/invitations", $auth, ['email' => 'one-too-many@example.com']);
        $this->assertQuota($r, Quota::PENDING_INVITATIONS_PER_CLUB, $limit);
        self::$em->clear();
        $this->assertSame($limit + 1, self::$em->getRepository(ClubInvitation::class)->count([]));

        self::$em->getConnection()->executeStatement("DELETE FROM club_invitation WHERE email = 'p0@example.com'");
        $this->assertSame(204, $this->req('POST', "/api/clubs/{$club->getId()}/invitations", $auth, ['email' => 'fits@example.com'])['status']);
    }

    public function testEventsPerCalendarOnEveryWritePath(): void
    {
        ['auth' => $auth, 'calendar' => $cal, 'base' => $base] = $this->setup1();
        $limit = Quota::LIMITS[Quota::EVENTS_PER_CALENDAR];
        $template = TestHelper::createTemplate(self::$em, $cal);
        $first = $this->req('POST', "$base/events", $auth, $this->eventBody());
        $this->assertSame(201, $first['status'], $first['content']);
        $this->fill('event', $cal->getId(), $limit - 2); // one event of room left (limit - 1 rows in total)

        $this->assertQuota($this->req('POST', "$base/events/from-template", $auth, ['templateId' => $template->getId(), 'dates' => ['2026-11-01', '2026-11-02']]), Quota::EVENTS_PER_CALENDAR, $limit);
        $this->assertQuota($this->req('POST', "$base/events/series", $auth, ['rule' => [
            'frequency' => 'weekly', 'weekday' => 4, 'startDate' => '2026-10-03', 'until' => '2026-10-31', 'skipHolidays' => false,
        ], 'event' => ['name' => 'Reihe', 'timeBegin' => '10:00', 'timeEnd' => '11:00']]), Quota::EVENTS_PER_CALENDAR, $limit);
        $import = ['events' => [
            ['name' => 'A', 'date' => '2027-01-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00'],
            ['name' => 'B', 'date' => '2027-01-02', 'timeBegin' => '10:00', 'timeEnd' => '11:00'],
        ]];
        $this->assertQuota($this->req('POST', "$base/events/import", $auth, $import), Quota::EVENTS_PER_CALENDAR, $limit);

        // The last free slot can still be used, the next one cannot
        $ok = $this->req('POST', "$base/events", $auth, $this->eventBody());
        $this->assertSame(201, $ok['status'], $ok['content']);
        $this->assertQuota($this->req('POST', "$base/events", $auth, $this->eventBody()), Quota::EVENTS_PER_CALENDAR, $limit);
    }

    /** @return iterable<string, array{string, string, string, array<string, mixed>}> */
    public static function calendarResources(): iterable
    {
        yield 'templates' => ['event_template', 'templates', Quota::TEMPLATES_PER_CALENDAR, ['name' => 'Vorlage', 'timeBegin' => '18:00', 'timeEnd' => '20:00']];
        yield 'properties' => ['property', 'properties', Quota::PROPERTIES_PER_CALENDAR, ['name' => 'Merkmal']];
        yield 'features' => ['feature', 'features', Quota::FEATURES_PER_CALENDAR, ['name' => 'Zusatz']];
    }

    /** @return iterable<string, array{string, string, string, array<string, mixed>}> */
    public static function clubResources(): iterable
    {
        yield 'feeds' => ['calendar_feed', 'feeds', Quota::FEEDS_PER_CLUB, ['name' => 'Feed']];
        yield 'locations' => ['location', 'locations', Quota::LOCATIONS_PER_CLUB, ['name' => 'Ort']];
        yield 'target groups' => ['target_group', 'target-groups', Quota::TARGET_GROUPS_PER_CLUB, ['name' => 'Gruppe']];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('clubResources')]
    public function testPerClubResourceQuota(string $table, string $path, string $resource, array $body): void
    {
        ['auth' => $auth, 'club' => $club, 'user' => $user, 'calendar' => $cal] = $this->setup1();
        $base = "/api/clubs/{$club->getId()}";
        $limit = Quota::LIMITS[$resource];
        // A feed selects calendars; the club of the isolation check below needs one of its own
        $bodyFor = static fn (string $calendarId): array => 'feeds' === $path ? $body + ['calendarIds' => [$calendarId]] : $body;
        $body = $bodyFor($cal->getId());

        $seed = $this->req('POST', "$base/$path", $auth, ['name' => 'Start'] + $body);
        $this->assertSame(201, $seed['status'], $seed['content']);
        $this->fill($table, $club->getId(), $limit - 2, 'club_id');
        $this->assertSame(201, $this->req('POST', "$base/$path", $auth, ['name' => 'Letzter'] + $body)['status']);
        $this->assertQuota($this->req('POST', "$base/$path", $auth, ['name' => 'Zu viel'] + $body), $resource, $limit);

        // Quotas count per club: a second club of the same user is not affected
        $other = TestHelper::createClub(self::$em, $user, 'Other');
        $otherCal = TestHelper::createCalendar(self::$em, $other);
        $this->assertSame(201, $this->req('POST', "/api/clubs/{$other->getId()}/$path", $auth, ['name' => 'Eins'] + $bodyFor($otherCal->getId()))['status']);
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('calendarResources')]
    public function testPerCalendarResourceQuota(string $table, string $path, string $resource, array $body): void
    {
        ['auth' => $auth, 'calendar' => $cal, 'base' => $base] = $this->setup1();
        $limit = Quota::LIMITS[$resource];

        $seed = $this->req('POST', "$base/$path", $auth, ['name' => 'Start'] + $body);
        $this->assertSame(201, $seed['status'], $seed['content']);
        $this->fill($table, $cal->getId(), $limit - 2);
        $this->assertSame(201, $this->req('POST', "$base/$path", $auth, ['name' => 'Letzter'] + $body)['status']);
        $this->assertQuota($this->req('POST', "$base/$path", $auth, ['name' => 'Zu viel'] + $body), $resource, $limit);
    }

    public function testLocationsOfAnImportCountAgainstTheQuota(): void
    {
        ['auth' => $auth, 'calendar' => $cal, 'base' => $base] = $this->setup1();
        $limit = Quota::LIMITS[Quota::LOCATIONS_PER_CLUB];
        $this->assertSame(201, $this->req('POST', TestHelper::clubBase(self::$em, $base).'/locations', $auth, ['name' => 'Start'])['status']);
        $this->fill('location', $cal->getClub()->getId(), $limit - 2, 'club_id');

        $r = $this->req('POST', "$base/events/import", $auth, [
            'locations' => [['tempId' => 'a', 'name' => 'Neu A'], ['tempId' => 'b', 'name' => 'Neu B']],
            'events' => [
                ['name' => 'A', 'date' => '2027-01-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00', 'locationTempId' => 'a'],
                ['name' => 'B', 'date' => '2027-01-02', 'timeBegin' => '10:00', 'timeEnd' => '11:00', 'locationTempId' => 'b'],
            ],
        ]);
        $this->assertQuota($r, Quota::LOCATIONS_PER_CLUB, $limit);
    }

    public function testHolidayCalendarsPerCalendar(): void
    {
        ['auth' => $auth, 'calendar' => $cal, 'base' => $base] = $this->setup1();
        $limit = Quota::LIMITS[Quota::HOLIDAY_CALENDARS_PER_CALENDAR];
        for ($i = 0; $i < $limit; ++$i) {
            self::$em->persist(new \App\Entity\HolidayCalendar(self::$em->getReference(Calendar::class, $cal->getId()), "Ferien $i", 'https://holidays.invalid/'.$i.'.ics'));
        }
        self::$em->flush();

        $r = $this->req('POST', "$base/holiday-calendars", $auth, ['name' => 'Zu viel', 'url' => 'https://holidays.invalid/x.ics']);
        $this->assertQuota($r, Quota::HOLIDAY_CALENDARS_PER_CALENDAR, $limit);
    }

    // --- request caps ---

    public function testFromTemplateDatesAreCapped(): void
    {
        ['auth' => $auth, 'calendar' => $cal, 'base' => $base] = $this->setup1();
        $template = TestHelper::createTemplate(self::$em, $cal);
        $dates = [];
        for ($i = 0; $i <= SeriesRule::MAX_EVENTS; ++$i) {
            $dates[] = (new \DateTimeImmutable('2026-01-01'))->modify("+$i days")->format('Y-m-d');
        }

        $r = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $template->getId(), 'dates' => $dates]);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('too_many_events', $r['body']['code']);
        $this->assertSame('dates', $r['body']['field']);

        $ok = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $template->getId(), 'dates' => array_slice($dates, 0, SeriesRule::MAX_EVENTS)]);
        $this->assertSame(201, $ok['status'], $ok['content']);
        $this->assertCount(SeriesRule::MAX_EVENTS, $ok['body']);
    }

    public function testIdListsAreCapped(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setup1();
        $ids = array_map(fn (int $i) => "id-$i", range(1, Input::MAX_IDS + 1));

        $r = $this->req('POST', "$base/events", $auth, $this->eventBody(['propertyIds' => $ids]));
        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertSame('validation_failed', $r['body']['code']);
        $this->assertSame('propertyIds', $r['body']['field']);

        $r = $this->req('GET', "$base/events?targetGroupIds=".implode(',', $ids), $auth);
        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertSame('targetGroupIds', $r['body']['field']);
    }

    // --- event list ---

    public function testListPagesAndReportsTheTotal(): void
    {
        ['auth' => $auth, 'calendar' => $cal, 'base' => $base] = $this->setup1();
        foreach ([1, 2, 3, 4, 5] as $day) {
            $this->assertSame(201, $this->req('POST', "$base/events", $auth, $this->eventBody(['name' => "E$day", 'date' => sprintf('2026-10-%02d', $day)]))['status']);
        }

        $all = $this->req('GET', "$base/events", $auth);
        $this->assertSame(200, $all['status']);
        $this->assertSame(['E1', 'E2', 'E3', 'E4', 'E5'], array_column($all['body'], 'name'));
        $this->assertSame(['5'], $all['headers']['x-total-count']);

        $page = $this->req('GET', "$base/events?limit=2&offset=2", $auth);
        $this->assertSame(['E3', 'E4'], array_column($page['body'], 'name'));
        $this->assertSame(['5'], $page['headers']['x-total-count']);

        $window = $this->req('GET', "$base/events?from=2026-10-02&to=2026-10-04&limit=1", $auth);
        $this->assertSame(['E2'], array_column($window['body'], 'name'));
        $this->assertSame(['3'], $window['headers']['x-total-count']);
    }

    /** @return iterable<string, array{string}> */
    public static function badPaging(): iterable
    {
        yield 'limit 0' => ['limit=0'];
        yield 'limit too large' => ['limit='.(EventService::LIST_MAX_LIMIT + 1)];
        yield 'limit text' => ['limit=abc'];
        yield 'limit array' => ['limit[]=1'];
        yield 'negative offset' => ['offset=-1'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('badPaging')]
    public function testListRejectsBadPaging(string $query): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setup1();
        $r = $this->req('GET', "$base/events?$query", $auth);
        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertSame('validation_failed', $r['body']['code']);
        $this->assertContains($r['body']['field'], ['limit', 'offset']);
    }

    public function testListRangeIsCapped(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setup1();
        $from = new \DateTimeImmutable('2020-01-01');
        $max = $from->modify('+'.EventService::LIST_MAX_RANGE_DAYS.' days')->format('Y-m-d');
        $tooLong = $from->modify('+'.(EventService::LIST_MAX_RANGE_DAYS + 1).' days')->format('Y-m-d');

        $this->assertSame(200, $this->req('GET', "$base/events?from=2020-01-01&to=$max", $auth)['status']);
        $r = $this->req('GET', "$base/events?from=2020-01-01&to=$tooLong", $auth);
        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertSame('validation_failed', $r['body']['code']);
        $this->assertSame('to', $r['body']['field']);
    }
}
