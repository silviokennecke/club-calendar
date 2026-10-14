<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\QueryCounter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Changing the rule of an event series later (`POST …/event-series/{id}/preview-update`, `PATCH
 * …/event-series/{id}`): only future events (date ≥ today in the calendar's zone) change, past events stay.
 * "Today" is frozen at Tuesday 2026-10-20 unless a test says otherwise.
 */
class EventSeriesRuleChangeTest extends WebTestCase
{
    use ClockSensitiveTrait;

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
        self::mockTime(new \DateTimeImmutable('2026-10-20 10:00:00', new \DateTimeZone('UTC')));
    }

    /** @return array{string, string, Calendar, string} auth, calendar base path, calendar, club id */
    private function setupCalendar(): array
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);

        return [TestHelper::authHeader($user, self::$tokens), "/api/calendars/{$cal->getId()}", $cal, $club->getId()];
    }

    /** @return array{status: int, body: mixed, content: string} */
    private function req(string $method, string $uri, string $auth, array $data = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $data, $auth);
    }

    /** Weekly Thursdays 2026-10-01 … 2026-11-26: 3 past (01, 08, 15 Oct), 6 future (22, 29 Oct, 5, 12, 19, 26 Nov). */
    private function rule(array $partial = []): array
    {
        return array_merge([
            'frequency' => 'weekly',
            'weekday' => 4,
            'startDate' => '2026-10-01',
            'until' => '2026-11-26',
            'skipHolidays' => false,
        ], $partial);
    }

    /** @return array{id: string, events: list<array>} */
    private function createSeries(string $base, string $auth, array $rule = [], array $event = []): array
    {
        $r = $this->req('POST', "$base/events/series", $auth, [
            'rule' => $this->rule($rule),
            'event' => array_merge(['name' => 'Training', 'timeBegin' => '19:00', 'timeEnd' => '21:00'], $event),
        ]);
        $this->assertSame(201, $r['status'], $r['content']);

        return ['id' => $r['body']['series']['id'], 'events' => $r['body']['events']];
    }

    /** @return array<string, array> events of the calendar by date (one per date in these tests) */
    private function eventsByDate(string $base, string $auth): array
    {
        self::$em->clear();
        $events = [];
        foreach ($this->req('GET', "$base/events", $auth)['body'] as $e) {
            $events[$e['date']] = $e;
        }

        return $events;
    }

    private function preview(string $base, string $auth, string $seriesId, array $rule): array
    {
        $r = $this->req('POST', "$base/event-series/$seriesId/preview-update", $auth, ['rule' => $rule]);
        $this->assertSame(200, $r['status'], $r['content']);

        return $r['body'];
    }

    private function change(string $base, string $auth, string $seriesId, array $rule): array
    {
        $r = $this->req('PATCH', "$base/event-series/$seriesId", $auth, ['rule' => $rule]);
        $this->assertSame(200, $r['status'], $r['content']);

        return $r['body'];
    }

    private function addHoliday(Calendar $calendar, string $name, string $date): void
    {
        $cal = self::$em->find(Calendar::class, $calendar->getId());
        $hc = new HolidayCalendar($cal, 'Feiertage', 'https://example.com/holidays.ics');
        self::$em->persist($hc);
        self::$em->persist(new HolidayEvent($hc, 'h1', $name, new \DateTimeImmutable($date), null));
        self::$em->flush();
    }

    // ---- Semantics --------------------------------------------------------------------------------

    public function testExtendingTheRuleCreatesTheMissingEvents(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $this->assertCount(9, $series['events']);

        $preview = $this->preview($base, $auth, $series['id'], $this->rule(['until' => '2026-12-17']));
        $this->assertSame([['date' => '2026-12-03'], ['date' => '2026-12-10'], ['date' => '2026-12-17']], $preview['toCreate']);
        $this->assertSame([], $preview['toDelete']);
        $this->assertSame(6, $preview['kept']);
        $this->assertSame(3, $preview['past']);
        $this->assertSame([], $preview['skippedHolidays']);
        // The preview writes nothing
        $this->assertCount(9, $this->eventsByDate($base, $auth));

        $r = $this->change($base, $auth, $series['id'], $this->rule(['until' => '2026-12-17']));
        $this->assertSame(3, $r['created']);
        $this->assertSame(0, $r['deleted']);
        $this->assertSame(6, $r['kept']);
        $this->assertSame('2026-12-17', $r['series']['rule']['until']);
        $this->assertSame(12, $r['series']['eventCount']);

        $events = $this->eventsByDate($base, $auth);
        $this->assertCount(12, $events);
        $this->assertSame($series['id'], $events['2026-12-17']['seriesId']);
        $this->assertSame('2026-12-17', $this->req('GET', "$base/event-series/{$series['id']}", $auth)['body']['rule']['until']);
    }

    public function testShorteningDeletesFutureEventsAndKeepsPastOnes(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $ids = array_column($series['events'], 'id', 'date');

        $preview = $this->preview($base, $auth, $series['id'], $this->rule(['until' => '2026-10-29']));
        $this->assertSame([], $preview['toCreate']);
        $this->assertSame(
            [
                ['id' => $ids['2026-11-05'], 'date' => '2026-11-05', 'name' => 'Training', 'isDraft' => true],
                ['id' => $ids['2026-11-12'], 'date' => '2026-11-12', 'name' => 'Training', 'isDraft' => true],
                ['id' => $ids['2026-11-19'], 'date' => '2026-11-19', 'name' => 'Training', 'isDraft' => true],
                ['id' => $ids['2026-11-26'], 'date' => '2026-11-26', 'name' => 'Training', 'isDraft' => true],
            ],
            $preview['toDelete'],
        );
        $this->assertSame(2, $preview['kept']);

        // An end before today removes all future events; past events stay even when the rule no longer has them
        $r = $this->change($base, $auth, $series['id'], $this->rule(['until' => '2026-10-08']));
        $this->assertSame([0, 6, 0], [$r['created'], $r['deleted'], $r['kept']]);
        $this->assertSame(3, $r['series']['eventCount']);
        $this->assertSame(['2026-10-01', '2026-10-08', '2026-10-15'], array_keys($this->eventsByDate($base, $auth)));
    }

    public function testChangingTheFrequencyOrWeekday(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $ids = array_column($series['events'], 'id', 'date');

        // Every second Thursday from the first match: 1, 15, 29 Oct, 12, 26 Nov
        $preview = $this->preview($base, $auth, $series['id'], $this->rule(['frequency' => 'biweekly']));
        $this->assertSame([], $preview['toCreate']);
        $this->assertSame(['2026-10-22', '2026-11-05', '2026-11-19'], array_column($preview['toDelete'], 'date'));
        $this->assertSame(3, $preview['kept']);

        // Monthly, first Thursday: only 5 Nov stays in the future
        $preview = $this->preview($base, $auth, $series['id'], $this->rule(['frequency' => 'monthly', 'nth' => 1]));
        $this->assertSame([], $preview['toCreate']);
        $this->assertSame(1, $preview['kept']);

        // Tuesdays instead of Thursdays: today (Tuesday 20 Oct) counts as future
        $r = $this->change($base, $auth, $series['id'], $this->rule(['weekday' => 2]));
        $this->assertSame([6, 6, 0], [$r['created'], $r['deleted'], $r['kept']]);
        $events = $this->eventsByDate($base, $auth);
        $this->assertSame(
            ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24'],
            array_keys($events),
        );
        $this->assertSame($ids['2026-10-15'], $events['2026-10-15']['id'], 'past events are not touched');
        $this->assertSame(['weekly', 2], [$r['series']['rule']['frequency'], $r['series']['rule']['weekday']]);
    }

    public function testSkipHolidaysOnAndOff(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $this->addHoliday($cal, 'Brückentag', '2026-11-05');
        // A holiday on a past date of the series is not part of the change (past events stay)
        $this->addHoliday($cal, 'Herbstferien', '2026-10-08');
        $series = $this->createSeries($base, $auth);
        $this->assertCount(9, $series['events']);

        $preview = $this->preview($base, $auth, $series['id'], $this->rule(['skipHolidays' => true]));
        $this->assertSame(['2026-11-05'], array_column($preview['toDelete'], 'date'));
        $this->assertSame([['date' => '2026-11-05', 'name' => 'Brückentag']], $preview['skippedHolidays']);
        $r = $this->change($base, $auth, $series['id'], $this->rule(['skipHolidays' => true]));
        $this->assertSame([0, 1, 5], [$r['created'], $r['deleted'], $r['kept']]);
        $this->assertArrayNotHasKey('2026-11-05', $this->eventsByDate($base, $auth));

        $r = $this->change($base, $auth, $series['id'], $this->rule(['skipHolidays' => false]));
        $this->assertSame([1, 0, 5], [$r['created'], $r['deleted'], $r['kept']]);
        $this->assertArrayHasKey('2026-11-05', $this->eventsByDate($base, $auth));
    }

    public function testEventsEditedOnTheirOwnStayAndNewEventsCopyThePrototype(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $loc = $this->req('POST', "$base/locations", $auth, ['name' => 'Schützenhaus'])['body']['id'];
        $prop = $this->req('POST', "$base/properties", $auth, ['name' => 'Tracht'])['body']['id'];
        $feat = $this->req('POST', "$base/features", $auth, ['name' => 'Bonusschießen'])['body']['id'];
        $group = $this->req('POST', "$base/target-groups", $auth, ['name' => 'Jugend'])['body']['id'];
        $series = $this->createSeries($base, $auth);
        $ids = array_column($series['events'], 'id', 'date');

        // Prototype = earliest future event (22 Oct), edited on its own: all its values go to new events
        $r = $this->req('PATCH', "$base/events/{$ids['2026-10-22']}", $auth, [
            'name' => 'Training (neu)', 'timeBegin' => '18:30', 'timeEnd' => '22:00', 'timezone' => 'Europe/Vienna',
            'locationId' => $loc, 'propertyIds' => [$prop], 'featureIds' => [$feat], 'targetGroupIds' => [$group],
            'isDraft' => false, 'dateEnd' => '2026-10-23',
        ]);
        $this->assertSame(200, $r['status'], $r['content']);
        // Another future event edited on its own keeps its values when its date stays in the rule
        $this->assertSame(200, $this->req('PATCH', "$base/events/{$ids['2026-10-29']}", $auth, ['name' => 'Sondertraining'])['status']);
        // A past event (not the prototype) keeps its values too
        $this->assertSame(200, $this->req('PATCH', "$base/events/{$ids['2026-10-15']}", $auth, ['name' => 'Vergangen'])['status']);

        $r = $this->change($base, $auth, $series['id'], $this->rule(['until' => '2026-12-03']));
        $this->assertSame(1, $r['created']);

        $events = $this->eventsByDate($base, $auth);
        $this->assertSame('Sondertraining', $events['2026-10-29']['name']);
        $this->assertSame($ids['2026-10-29'], $events['2026-10-29']['id']);
        $this->assertSame('Vergangen', $events['2026-10-15']['name']);
        $new = $events['2026-12-03'];
        $this->assertSame(
            ['Training (neu)', '18:30', '22:00', 'Europe/Vienna', $loc, false, false, '2026-12-04', $series['id']],
            [$new['name'], $new['timeBegin'], $new['timeEnd'], $new['timezone'], $new['locationId'], $new['isDraft'], $new['isAllDay'], $new['dateEnd'], $new['seriesId']],
        );
        $this->assertSame([$prop], array_column($new['properties'], 'propertyId'));
        $this->assertSame([$feat], array_column($new['features'], 'featureId'));
        $this->assertSame([$group], array_column($new['targetGroups'], 'targetGroupId'));
    }

    public function testAllDayPrototype(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth, [], ['name' => 'Fest', 'isAllDay' => true, 'timeBegin' => null, 'timeEnd' => null]);

        $this->change($base, $auth, $series['id'], $this->rule(['until' => '2026-12-03']));
        $new = $this->eventsByDate($base, $auth)['2026-12-03'];
        $this->assertSame([true, '00:00', '23:59', null], [$new['isAllDay'], $new['timeBegin'], $new['timeEnd'], $new['dateEnd']]);
    }

    public function testPreviewMatchesTheResult(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $before = $this->eventsByDate($base, $auth);
        $rule = $this->rule(['frequency' => 'biweekly', 'weekday' => 5, 'until' => '2027-01-31']);

        $preview = $this->preview($base, $auth, $series['id'], $rule);
        $r = $this->change($base, $auth, $series['id'], $rule);
        $after = $this->eventsByDate($base, $auth);

        $this->assertSame(count($preview['toCreate']), $r['created']);
        $this->assertSame(count($preview['toDelete']), $r['deleted']);
        $this->assertSame($preview['kept'], $r['kept']);
        $this->assertSame(array_column($preview['toCreate'], 'date'), array_values(array_diff(array_keys($after), array_keys($before))));
        $this->assertSame(array_column($preview['toDelete'], 'id'), array_values(array_diff(array_column($before, 'id'), array_column($after, 'id'))));
    }

    public function testCountAndUntilCountFromTheStartOfTheRule(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $byCount = $this->rule(['count' => 5]);
        unset($byCount['until']);

        // 5 dates from 1 Oct: 1, 8, 15 (past), 22, 29 Oct → the 4 later future events go
        $preview = $this->preview($base, $auth, $series['id'], $byCount);
        $this->assertSame(['2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26'], array_column($preview['toDelete'], 'date'));
        $r = $this->change($base, $auth, $series['id'], $byCount);
        $this->assertSame(5, $r['series']['rule']['count']);
        $this->assertNull($r['series']['rule']['until']);
        $this->assertSame(5, $r['series']['eventCount']);
    }

    // ---- Edge cases -------------------------------------------------------------------------------

    public function testSeriesWithOnlyPastEventsUsesTheLatestAsPrototype(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $ids = array_column($series['events'], 'id', 'date');
        $this->assertSame(200, $this->req('PATCH', "$base/events/{$ids['2026-11-26']}", $auth, ['name' => 'Letztes'])['status']);
        self::mockTime(new \DateTimeImmutable('2026-12-01 12:00:00', new \DateTimeZone('UTC')));

        $r = $this->change($base, $auth, $series['id'], $this->rule(['until' => '2026-12-17']));
        $this->assertSame([3, 0, 0], [$r['created'], $r['deleted'], $r['kept']]);
        $events = $this->eventsByDate($base, $auth);
        $this->assertSame('Letztes', $events['2026-12-17']['name']);
        $this->assertSame('Training', $events['2026-11-19']['name']);
    }

    public function testSeriesWithOnlyFutureEvents(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth, ['startDate' => '2026-11-01']);
        $this->assertCount(4, $series['events']);

        $preview = $this->preview($base, $auth, $series['id'], $this->rule(['startDate' => '2026-11-01', 'weekday' => 1]));
        $this->assertSame(0, $preview['past']);
        $this->assertSame(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'], array_column($preview['toCreate'], 'date'));
        $this->assertCount(4, $preview['toDelete']);

        // A rule whose dates all lie in the past would leave the series without events
        $r = $this->req('PATCH', "$base/event-series/{$series['id']}", $auth, ['rule' => $this->rule(['until' => '2026-10-10'])]);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame(['validation_failed', 'rule'], [$r['body']['code'], $r['body']['field']]);
        $this->assertCount(4, $this->eventsByDate($base, $auth));
    }

    public function testTodayIsTheDayInTheCalendarsZone(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        [$nyAuth, $nyBase, $nyCal] = $this->setupCalendar();
        $c = self::$em->find(Calendar::class, $nyCal->getId());
        $c->setTimezone('America/New_York');
        self::$em->flush();
        $series = $this->createSeries($base, $auth);
        $nySeries = $this->createSeries($nyBase, $nyAuth);

        // 2026-10-22 22:30 UTC: already Friday 23 Oct in Berlin (club zone), still Thursday 22 Oct in New York
        self::mockTime(new \DateTimeImmutable('2026-10-22 22:30:00', new \DateTimeZone('UTC')));
        $shorter = $this->rule(['until' => '2026-10-15']);

        $berlin = $this->preview($base, $auth, $series['id'], $shorter);
        $this->assertSame('2026-10-29', $berlin['toDelete'][0]['date'], 'the 22nd is past in Berlin');
        $this->assertSame(4, $berlin['past']);
        $ny = $this->preview($nyBase, $nyAuth, $nySeries['id'], $shorter);
        $this->assertSame('2026-10-22', $ny['toDelete'][0]['date'], 'the 22nd is today in New York');
        $this->assertSame(3, $ny['past']);
    }

    public function testTooManyEventsAfterTheChange(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        // 366 Wednesdays from 1 Oct (2 of them past) + the 3 past Thursdays that stay = 367 events
        $wednesdays = $this->rule(['weekday' => 3, 'count' => 366]);
        unset($wednesdays['until']);

        foreach (['POST' => 'preview-update', 'PATCH' => ''] as $method => $suffix) {
            $r = $this->req($method, rtrim("$base/event-series/{$series['id']}/$suffix", '/'), $auth, ['rule' => $wednesdays]);
            $this->assertSame(422, $r['status'], $r['content']);
            $this->assertSame('too_many_events', $r['body']['code']);
        }
        // A rule with more than 366 dates is rejected like when creating
        $r = $this->req('POST', "$base/event-series/{$series['id']}/preview-update", $auth, ['rule' => $this->rule(['until' => '2035-01-01'])]);
        $this->assertSame(422, $r['status']);
        $this->assertCount(9, $this->eventsByDate($base, $auth));
        // Exactly 366 is fine: 363 future Thursdays from the same start + 3 past ones
        $thursdays = $this->rule(['count' => 366]);
        unset($thursdays['until']);
        $this->assertSame(366, $this->change($base, $auth, $series['id'], $thursdays)['series']['eventCount']);
    }

    public function testValidationLikeCreating(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $uri = "$base/event-series/{$series['id']}";

        foreach (['rule.weekday' => ['weekday' => 9], 'rule.nth' => ['frequency' => 'monthly'], 'rule.until' => ['until' => '2026-01-01'], 'rule' => ['count' => 3]] as $field => $partial) {
            $r = $this->req('PATCH', $uri, $auth, ['rule' => $this->rule($partial)]);
            $this->assertSame(400, $r['status'], $field);
            $this->assertSame(['validation_failed', $field], [$r['body']['code'], $r['body']['field']]);
        }
        $this->assertSame(400, $this->req('PATCH', $uri, $auth, [])['status']);
        $this->assertSame(400, $this->req('POST', "$uri/preview-update", $auth, ['rule' => 'weekly'])['status']);

        // Broken JSON
        foreach (['PATCH' => $uri, 'POST' => "$uri/preview-update"] as $method => $target) {
            self::$client->request($method, $target, [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => $auth], '{"rule": ');
            $this->assertSame(400, self::$client->getResponse()->getStatusCode());
            $this->assertSame('invalid_request', json_decode((string) self::$client->getResponse()->getContent(), true)['code']);
        }
        $this->assertCount(9, $this->eventsByDate($base, $auth));
    }

    // ---- Access -----------------------------------------------------------------------------------

    public function testAccessRules(): void
    {
        [$auth, $base, $cal, $clubId] = $this->setupCalendar();
        [$otherAuth, $otherBase] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $foreign = $this->createSeries($otherBase, $otherAuth);
        $stranger = TestHelper::authHeader(TestHelper::createUser(self::$em, self::$hasher), self::$tokens);
        $body = ['rule' => $this->rule(['until' => '2026-12-31'])];

        foreach (['POST' => "/{$series['id']}/preview-update", 'PATCH' => "/{$series['id']}"] as $method => $path) {
            $this->assertSame(403, $this->req($method, "$base/event-series$path", $stranger, $body)['status'], "$method non-member");
            $this->assertContains(TestHelper::jsonRequest(self::$client, $method, "$base/event-series$path", $body)['status'], [401, 403]);
        }
        // A series of another calendar through my calendar, and an unknown series: 404
        $this->assertSame(404, $this->req('POST', "$base/event-series/{$foreign['id']}/preview-update", $auth, $body)['status']);
        $this->assertSame(404, $this->req('PATCH', "$base/event-series/{$foreign['id']}", $auth, $body)['status']);
        $this->assertSame(404, $this->req('PATCH', "$base/event-series/00000000-0000-7000-8000-000000000000", $auth, $body)['status']);
        $this->assertCount(9, $this->eventsByDate($otherBase, $otherAuth));

        // Archived calendar: read-only
        $this->assertSame(200, $this->req('POST', "/api/clubs/$clubId/calendars/{$cal->getId()}/archive", $auth)['status']);
        $this->assertSame(403, $this->req('POST', "$base/event-series/{$series['id']}/preview-update", $auth, $body)['status']);
        $this->assertSame(403, $this->req('PATCH', "$base/event-series/{$series['id']}", $auth, $body)['status']);
        $this->assertCount(9, $this->eventsByDate($base, $auth));
    }

    // ---- Atomicity, concurrency, queries ----------------------------------------------------------

    public function testADatabaseErrorChangesNothing(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $before = $this->eventsByDate($base, $auth);
        $conn = self::$em->getConnection();
        // Deleting runs before inserting: a failing insert must roll back the deletes as well
        $conn->executeStatement("CREATE TRIGGER test_fail_event_insert BEFORE INSERT ON event FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced failure'");
        try {
            $r = $this->req('PATCH', "$base/event-series/{$series['id']}", $auth, ['rule' => $this->rule(['weekday' => 2])]);
            $this->assertSame(500, $r['status'], $r['content']);
        } finally {
            $conn->executeStatement('DROP TRIGGER IF EXISTS test_fail_event_insert');
        }

        $after = $this->eventsByDate($base, $auth);
        $this->assertSame(array_column($before, 'id'), array_column($after, 'id'));
        $rule = $this->req('GET', "$base/event-series/{$series['id']}", $auth)['body']['rule'];
        $this->assertSame([4, '2026-11-26'], [$rule['weekday'], $rule['until']]);
    }

    public function testEventsDeletedMeanwhileAreNoError(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $ids = array_column($series['events'], 'id', 'date');
        $shorter = $this->rule(['until' => '2026-10-29']);
        $this->assertCount(4, $this->preview($base, $auth, $series['id'], $shorter)['toDelete']);

        // Between preview and change another member deletes an event the change would delete
        $this->assertSame(200, $this->req('DELETE', "$base/events/{$ids['2026-11-12']}", $auth)['status']);
        $r = $this->change($base, $auth, $series['id'], $shorter);
        $this->assertSame([0, 3, 2], [$r['created'], $r['deleted'], $r['kept']]);

        // A series row without events (left by a parallel delete before its clean-up): 409 series_empty
        self::$em->getConnection()->executeStatement('DELETE FROM event WHERE series_id = ?', [$series['id']]);
        $r = $this->req('PATCH', "$base/event-series/{$series['id']}", $auth, ['rule' => $this->rule()]);
        $this->assertSame(409, $r['status'], $r['content']);
        $this->assertSame('series_empty', $r['body']['code']);
        $this->assertSame(409, $this->req('POST', "$base/event-series/{$series['id']}/preview-update", $auth, ['rule' => $this->rule()])['status']);
        $this->assertSame(0, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM event WHERE calendar_id = ?', [$cal->getId()]));
    }

    public function testQueriesStayConstantForMoreEvents(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $prop = $this->req('POST', "$base/properties", $auth, ['name' => 'Tracht'])['body']['id'];
        $event = ['propertyIds' => [$prop]];
        $short = $this->createSeries($base, $auth, [], $event);
        $long = $this->createSeries($base, $auth, [], $event);
        self::$em->clear();

        QueryCounter::$count = 0;
        $this->assertSame(4, $this->change($base, $auth, $short['id'], $this->rule(['until' => '2026-12-24']))['created']);
        $shortQueries = QueryCounter::$count;
        self::$em->clear();

        QueryCounter::$count = 0;
        $this->assertSame(13, $this->change($base, $auth, $long['id'], $this->rule(['until' => '2027-02-25']))['created']);
        // Reads are constant; writes are one INSERT per new event and one per assignment
        $extraRows = (13 - 4) * 2;
        $this->assertLessThanOrEqual($shortQueries + $extraRows, QueryCounter::$count, 'no read query per event');
    }
}
