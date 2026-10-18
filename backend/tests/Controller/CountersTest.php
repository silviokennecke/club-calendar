<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\QueryCounter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Counters of clubs, calendars, reference data and templates (package 1 of BACKEND-PLAN.md),
 * the single feed GET and the optional name of a calendar copy.
 */
class CountersTest extends WebTestCase
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

    private function auth(User $user): string
    {
        return TestHelper::authHeader($user, self::$tokens);
    }

    /** @return array{status: int, body: mixed} */
    private function req(string $method, string $uri, string $auth, array $data = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $data, $auth);
    }

    private function addMember(Club $club, User $user): void
    {
        // The client reboots the kernel between requests: work with managed copies
        $cu = new ClubUser();
        $cu->setClub(self::$em->find(Club::class, $club->getId()));
        $cu->setUser(self::$em->find(User::class, $user->getId()));
        self::$em->persist($cu);
        self::$em->flush();
    }

    private function archive(Calendar $calendar): void
    {
        self::$em->find(Calendar::class, $calendar->getId())?->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
    }

    /** Club with one active calendar (2 events, 1 template), one archived calendar (1 event); 3 feeds: one on each calendar, one on both. */
    private function populatedClub(User $user, string $name = 'Verein'): Club
    {
        $user = self::$em->find(User::class, $user->getId()) ?? $user;
        $club = TestHelper::createClub(self::$em, $user, $name);
        $active = TestHelper::createCalendar(self::$em, $club, 'Aktiv');
        $archived = TestHelper::createCalendar(self::$em, $club, 'Alt');
        TestHelper::createEvent(self::$em, $active);
        TestHelper::createEvent(self::$em, $active);
        TestHelper::createEvent(self::$em, $archived);
        TestHelper::createTemplate(self::$em, $active);
        $auth = $this->auth($user);
        $feeds = "/api/clubs/{$club->getId()}/feeds";
        $this->req('POST', $feeds, $auth, ['name' => 'Alle', 'visibility' => 'PUBLIC', 'calendarIds' => [$active->getId()]]);
        $this->req('POST', $feeds, $auth, ['name' => 'Alt', 'visibility' => 'PRIVATE', 'calendarIds' => [$archived->getId()]]);
        $this->req('POST', $feeds, $auth, ['name' => 'Beide', 'visibility' => 'CLUB', 'calendarIds' => [$active->getId(), $archived->getId()]]);
        $this->archive($archived);

        return $club;
    }

    // --- Clubs ---

    public function testClubListCountsActiveAndArchivedCalendarsAndMembers(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $other = TestHelper::createUser(self::$em, self::$hasher);
        $club = $this->populatedClub($user);
        $this->addMember($club, $other);
        $empty = TestHelper::createClub(self::$em, self::$em->find(User::class, $user->getId()), 'Leer');

        $r = $this->req('GET', '/api/clubs', $this->auth($user));
        $this->assertSame(200, $r['status']);
        $byId = array_column($r['body'], null, 'id');
        $this->assertSame(1, $byId[$club->getId()]['calendarCount']);
        $this->assertSame(1, $byId[$club->getId()]['archivedCalendarCount']);
        $this->assertSame(2, $byId[$club->getId()]['memberCount']);
        $this->assertSame(['calendars' => 2], $byId[$club->getId()]['_count']);
        $this->assertSame(0, $byId[$empty->getId()]['calendarCount']);
        $this->assertSame(0, $byId[$empty->getId()]['archivedCalendarCount']);
        $this->assertSame(1, $byId[$empty->getId()]['memberCount']);
    }

    public function testClubListRunsTheSameNumberOfQueriesForMoreClubs(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $this->populatedClub($user, 'Eins');
        $auth = $this->auth($user);

        QueryCounter::$count = 0;
        $this->req('GET', '/api/clubs', $auth);
        $oneClub = QueryCounter::$count;

        $this->populatedClub($user, 'Zwei');
        $this->populatedClub($user, 'Drei');
        QueryCounter::$count = 0;
        $r = $this->req('GET', '/api/clubs', $auth);
        $this->assertCount(3, $r['body']);
        $this->assertSame($oneClub, QueryCounter::$count, 'no query per club');
    }

    public function testClubDetailCountsEventsAndFeedsOfAllCalendars(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $club = $this->populatedClub($user);
        // Another club's data must not be counted
        $this->populatedClub($user, 'Fremd');

        $r = $this->req('GET', "/api/clubs/{$club->getId()}", $this->auth($user));
        $this->assertSame(200, $r['status']);
        $this->assertSame(1, $r['body']['calendarCount']);
        $this->assertSame(1, $r['body']['archivedCalendarCount']);
        $this->assertSame(1, $r['body']['memberCount']);
        $this->assertSame(3, $r['body']['eventCount']);
        $this->assertSame(3, $r['body']['feedCount'], 'feeds of the club, each once');
    }

    public function testClubDetailOfAForeignClubIsDenied(): void
    {
        $owner = TestHelper::createUser(self::$em, self::$hasher);
        $stranger = TestHelper::createUser(self::$em, self::$hasher);
        $club = $this->populatedClub($owner);

        $r = $this->req('GET', "/api/clubs/{$club->getId()}", $this->auth($stranger));
        $this->assertSame(403, $r['status']);
        $this->assertArrayNotHasKey('eventCount', $r['body']);
    }

    // --- Calendars ---

    public function testCalendarListAndDetailCountEventsTemplatesAndFeeds(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $club = $this->populatedClub($user);
        $auth = $this->auth($user);

        $r = $this->req('GET', "/api/clubs/{$club->getId()}/calendars?includeArchived=true", $auth);
        $this->assertSame(200, $r['status']);
        $byName = array_column($r['body'], null, 'name');
        $this->assertSame([2, 1, 2, 1], [$byName['Aktiv']['eventCount'], $byName['Aktiv']['templateCount'], $byName['Aktiv']['feedCount'], $byName['Aktiv']['exclusiveFeedCount']]);
        $this->assertSame([1, 0, 2, 1], [$byName['Alt']['eventCount'], $byName['Alt']['templateCount'], $byName['Alt']['feedCount'], $byName['Alt']['exclusiveFeedCount']]);

        $one = $this->req('GET', "/api/clubs/{$club->getId()}/calendars/{$byName['Aktiv']['id']}", $auth);
        $this->assertSame(200, $one['status']);
        $this->assertSame(2, $one['body']['eventCount']);
        $this->assertSame(1, $one['body']['templateCount']);
        $this->assertSame(2, $one['body']['feedCount']);
        $this->assertSame(1, $one['body']['exclusiveFeedCount'], 'the feed on both calendars survives deleting one');
    }

    public function testCalendarListRunsTheSameNumberOfQueriesForMoreCalendars(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $club = TestHelper::createClub(self::$em, $user);
        TestHelper::createEvent(self::$em, TestHelper::createCalendar(self::$em, $club, 'A'));
        $auth = $this->auth($user);
        $uri = "/api/clubs/{$club->getId()}/calendars?includeArchived=true";

        QueryCounter::$count = 0;
        $this->req('GET', $uri, $auth);
        $oneCalendar = QueryCounter::$count;

        foreach (['B', 'C', 'D'] as $name) {
            $cal = TestHelper::createCalendar(self::$em, $club, $name);
            TestHelper::createEvent(self::$em, $cal);
            TestHelper::createTemplate(self::$em, $cal);
        }
        QueryCounter::$count = 0;
        $r = $this->req('GET', $uri, $auth);
        $this->assertCount(4, $r['body']);
        $this->assertSame($oneCalendar, QueryCounter::$count, 'no query per calendar');
    }

    // --- Usage of reference data ---

    public function testReferenceListsReportUsageWithNamesOfFewEvents(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $base = "/api/calendars/{$cal->getId()}";
        $prop = $this->req('POST', $base.'/properties', $auth, ['name' => 'Draußen'])['body']['id'];
        $busy = $this->req('POST', $base.'/properties', $auth, ['name' => 'Tracht'])['body']['id'];
        $unused = $this->req('POST', $base.'/properties', $auth, ['name' => 'Leer'])['body']['id'];
        $feature = $this->req('POST', $base.'/features', $auth, ['name' => 'Bonusschießen'])['body']['id'];
        $group = $this->req('POST', TestHelper::clubBase(self::$em, $base).'/target-groups', $auth, ['name' => 'Jugend'])['body']['id'];

        $event = fn (string $name, array $extra) => $this->req('POST', "$base/events", $auth, [
            'name' => $name, 'date' => '2026-10-24', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
        ] + $extra);
        $event('Herbstfest', ['propertyIds' => [$prop, $busy], 'featureIds' => [$feature], 'targetGroupIds' => [$group]]);
        $event('Arbeitsdienst', ['propertyIds' => [$prop, $busy]]);
        $event('Arbeitsdienst', ['propertyIds' => [$busy]]);
        $event('Training', ['propertyIds' => [$busy]]);
        $this->req('POST', "$base/templates", $auth, ['name' => 'Vorlage', 'propertyIds' => [$prop], 'targetGroupIds' => [$group]]);
        $feeds = TestHelper::clubBase(self::$em, $base).'/feeds';
        $this->req('POST', $feeds, $auth, ['name' => 'Jugendfeed', 'visibility' => 'PUBLIC', 'targetGroupIds' => [$group], 'calendarIds' => [$cal->getId()]]);
        $this->req('POST', $feeds, $auth, ['name' => 'Alle', 'visibility' => 'PUBLIC', 'calendarIds' => [$cal->getId()]]);

        $props = array_column($this->req('GET', $base.'/properties', $auth)['body'], null, 'id');
        // 2 events: names in date order, distinct
        $this->assertSame(['events' => 2, 'templates' => 1, 'eventNames' => ['Herbstfest', 'Arbeitsdienst']], $props[$prop]['usage']);
        // 4 events: more than 3, no names
        $this->assertSame(['events' => 4, 'templates' => 0, 'eventNames' => []], $props[$busy]['usage']);
        $this->assertSame(['events' => 0, 'templates' => 0, 'eventNames' => []], $props[$unused]['usage']);
        // Response otherwise unchanged
        $this->assertSame('Draußen', $props[$prop]['name']);
        $this->assertSame($cal->getId(), $props[$prop]['calendarId']);

        $features = $this->req('GET', $base.'/features', $auth)['body'];
        $this->assertSame(['events' => 1, 'templates' => 0, 'eventNames' => ['Herbstfest']], $features[0]['usage']);

        $groups = $this->req('GET', TestHelper::clubBase(self::$em, $base).'/target-groups', $auth)['body'];
        $this->assertSame(['events' => 1, 'templates' => 1, 'feeds' => 1, 'eventNames' => ['Herbstfest']], $groups[0]['usage']);
    }

    public function testUsageCountsAllCalendarsOfTheClubAndNothingOfOtherClubs(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $second = TestHelper::createCalendar(self::$em, $club, 'Zweiter');
        $foreignClub = TestHelper::createClub(self::$em, self::$em->find(User::class, $user->getId()), 'Fremd');
        $foreignCal = TestHelper::createCalendar(self::$em, $foreignClub, 'Fremdkalender');
        $auth = $this->auth($user);
        $mine = $this->req('POST', "/api/clubs/{$club->getId()}/target-groups", $auth, ['name' => 'Jugend'])['body']['id'];
        $theirs = $this->req('POST', "/api/clubs/{$foreignClub->getId()}/target-groups", $auth, ['name' => 'Jugend'])['body']['id'];
        $event = ['date' => '2026-10-24', 'timeBegin' => '18:00', 'timeEnd' => '20:00'];
        $this->req('POST', "/api/calendars/{$cal->getId()}/events", $auth, ['name' => 'Eins', 'targetGroupIds' => [$mine]] + $event);
        $this->req('POST', "/api/calendars/{$second->getId()}/events", $auth, ['name' => 'Zwei', 'targetGroupIds' => [$mine]] + $event);
        $this->req('POST', "/api/calendars/{$foreignCal->getId()}/events", $auth, ['name' => 'Fremd', 'targetGroupIds' => [$theirs]] + $event);

        $groups = $this->req('GET', "/api/clubs/{$club->getId()}/target-groups", $auth)['body'];
        $this->assertCount(1, $groups);
        $this->assertSame($mine, $groups[0]['id']);
        $this->assertSame(['events' => 2, 'templates' => 0, 'feeds' => 0, 'eventNames' => ['Eins', 'Zwei']], $groups[0]['usage']);
    }

    public function testLocationListReportsUsageAndTemplateNames(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $base = "/api/calendars/{$cal->getId()}";
        $place = $this->req('POST', TestHelper::clubBase(self::$em, $base).'/locations', $auth, ['name' => 'Vereinsheim'])['body']['id'];
        $empty = $this->req('POST', TestHelper::clubBase(self::$em, $base).'/locations', $auth, ['name' => 'Wiese'])['body']['id'];
        foreach (['A', 'B'] as $name) {
            $this->req('POST', "$base/events", $auth, [
                'name' => $name, 'date' => '2026-10-24', 'timeBegin' => '18:00', 'timeEnd' => '20:00', 'locationId' => $place,
            ]);
        }
        $this->req('POST', "$base/templates", $auth, ['name' => 'Vereinsabend', 'locationId' => $place]);

        $list = array_column($this->req('GET', TestHelper::clubBase(self::$em, $base).'/locations', $auth)['body'], null, 'id');
        $this->assertSame(['events' => 2, 'templates' => 1, 'templateNames' => ['Vereinsabend']], $list[$place]['usage']);
        $this->assertSame(['events' => 0, 'templates' => 0, 'templateNames' => []], $list[$empty]['usage']);
        $this->assertSame('Vereinsheim', $list[$place]['name']);
    }

    public function testTemplatesReportTheNumberOfEventsCreatedFromThem(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $base = "/api/calendars/{$cal->getId()}";
        $used = TestHelper::createTemplate(self::$em, $cal, ['name' => 'Training'])->getId();
        $unused = TestHelper::createTemplate(self::$em, $cal, ['name' => 'Fest'])->getId();
        $r = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $used, 'dates' => ['2026-10-01', '2026-10-08', '2026-10-15']]);
        $this->assertSame(201, $r['status']);

        $list = array_column($this->req('GET', "$base/templates", $auth)['body'], null, 'id');
        $this->assertSame(3, $list[$used]['eventCount']);
        $this->assertSame(0, $list[$unused]['eventCount']);
        $this->assertSame(3, $this->req('GET', "$base/templates/$used", $auth)['body']['eventCount']);
    }

    // --- Single feed ---

    public function testSingleFeedHasTheListSerializationAndStaysInItsClub(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        ['user' => $otherUser, 'club' => $otherClub] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $base = "/api/clubs/{$club->getId()}";
        $group = $this->req('POST', "$base/target-groups", $auth, ['name' => 'Jugend'])['body']['id'];
        $feed = $this->req('POST', "$base/feeds", $auth, [
            'name' => 'Jugend', 'visibility' => 'PRIVATE', 'targetGroupIds' => [$group], 'calendarIds' => [$cal->getId()],
        ])['body'];

        $r = $this->req('GET', "$base/feeds/{$feed['id']}", $auth);
        $this->assertSame(200, $r['status']);
        $this->assertSame([$cal->getId()], $r['body']['calendarIds']);
        $this->assertSame($club->getId(), $r['body']['clubId']);
        $list = $this->req('GET', "$base/feeds", $auth)['body'];
        $this->assertSame($list[0], $r['body']);

        // The feed through another club the caller belongs to: 404 like an unknown id
        $this->assertSame(404, $this->req('GET', "/api/clubs/{$otherClub->getId()}/feeds/{$feed['id']}", $this->auth($otherUser))['status']);
        $this->assertSame(404, $this->req('GET', "$base/feeds/unknown", $auth)['status']);

        // Not a member: 403 before anything about the feed is looked up
        $this->assertSame(403, $this->req('GET', "$base/feeds/{$feed['id']}", $this->auth($otherUser))['status']);
    }

    // --- Duplicate with name ---

    public function testDuplicateTakesAnOptionalName(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $uri = "/api/clubs/{$club->getId()}/calendars/{$cal->getId()}/duplicate";

        $named = $this->req('POST', $uri, $auth, ['name' => 'Kopie von Test Calendar']);
        $this->assertSame(201, $named['status']);
        $this->assertSame('Kopie von Test Calendar', $named['body']['name']);

        $default = $this->req('POST', $uri, $auth);
        $this->assertSame(201, $default['status']);
        $this->assertSame('Copy of Test Calendar', $default['body']['name']);

        $this->assertSame(400, $this->req('POST', $uri, $auth, ['name' => '   '])['status']);
        $this->assertSame(400, $this->req('POST', $uri, $auth, ['name' => str_repeat('x', 256)])['status']);
    }

    // --- Unique names ---

    /**
     * @return iterable<string, array{string}>
     */
    public static function referencePaths(): iterable
    {
        yield 'properties' => ['properties'];
        yield 'features' => ['features'];
        yield 'target groups' => ['target-groups'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('referencePaths')]
    public function testDuplicateNamesAreRejectedPerScope(string $path): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $otherClub = TestHelper::createClub(self::$em, self::$em->find(User::class, $user->getId()), 'Anderer Verein');
        $otherCal = TestHelper::createCalendar(self::$em, $club, 'Anderer');
        $auth = $this->auth($user);
        // Properties and features are unique per calendar, target groups per club
        $perCalendar = 'target-groups' !== $path;
        $base = $perCalendar ? "/api/calendars/{$cal->getId()}/$path" : "/api/clubs/{$club->getId()}/$path";

        $first = $this->req('POST', $base, $auth, ['name' => 'Jugend']);
        $this->assertSame(201, $first['status']);

        $dup = $this->req('POST', $base, $auth, ['name' => '  jUGEND ']);
        $this->assertSame(422, $dup['status']);
        $this->assertSame('duplicate_name', $dup['body']['code']);
        $this->assertSame('name', $dup['body']['field']);

        // Unicode: case-insensitive for umlauts, no-break spaces are trimmed like in the frontend, but the
        // database collation's "ä = a" / "ß = ss" does not apply
        $this->assertSame(201, $this->req('POST', $base, $auth, ['name' => 'Ältere'])['status']);
        $this->assertSame('duplicate_name', $this->req('POST', $base, $auth, ['name' => "\u{00A0}ältere\u{2003}"])['body']['code'] ?? null);
        $this->assertSame(201, $this->req('POST', $base, $auth, ['name' => 'Altere'])['status']);
        $this->assertSame(201, $this->req('POST', $base, $auth, ['name' => 'Schießen'])['status']);
        $this->assertSame(201, $this->req('POST', $base, $auth, ['name' => 'Schiessen'])['status']);
        foreach (['Ältere', 'Altere', 'Schießen', 'Schiessen'] as $name) {
            $id = array_column($this->req('GET', $base, $auth)['body'], 'id', 'name')[$name];
            $this->assertSame(200, $this->req('DELETE', "$base/$id", $auth)['status']);
        }

        // Same name in another calendar (properties, features) or club (target groups) is fine
        $otherBase = $perCalendar ? "/api/calendars/{$otherCal->getId()}/$path" : "/api/clubs/{$otherClub->getId()}/$path";
        $this->assertSame(201, $this->req('POST', $otherBase, $auth, ['name' => 'Jugend'])['status']);

        // Rename: own name (other spelling) is fine, another item's name is not
        $second = $this->req('POST', $base, $auth, ['name' => 'Erwachsene'])['body']['id'];
        $this->assertSame(200, $this->req('PATCH', "$base/{$first['body']['id']}", $auth, ['name' => 'JUGEND'])['status']);
        $rename = $this->req('PATCH', "$base/$second", $auth, ['name' => 'jugend']);
        $this->assertSame(422, $rename['status']);
        $this->assertSame('duplicate_name', $rename['body']['code']);

        // Nothing was stored by the rejected requests
        $names = array_column($this->req('GET', $base, $auth)['body'], 'name');
        sort($names);
        $this->assertSame(['Erwachsene', 'JUGEND'], $names);
    }
}
