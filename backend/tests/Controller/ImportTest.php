<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Event;
use App\Entity\Location;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\QueryCounter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Import preview (dry run with duplicates and errors per entry) and the atomic import with new places,
 * skipped duplicates, externalUid and tolerated outdated time zones.
 */
class ImportTest extends WebTestCase
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

    /** @return array{auth: string, base: string, calendar: Calendar, user: \App\Entity\User} */
    private function setupCalendar(): array
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        self::$em->find(Calendar::class, $cal->getId())?->setTimezone('Europe/Vienna');
        self::$em->flush();

        return ['auth' => TestHelper::authHeader($user, self::$tokens), 'base' => "/api/calendars/{$cal->getId()}", 'calendar' => $cal, 'user' => $user];
    }

    private function event(array $overrides = []): array
    {
        return $overrides + [
            'name' => 'Training', 'date' => '2026-10-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00',
            'isAllDay' => false, 'isDraft' => true,
        ];
    }

    private function post(string $uri, array $body, string $auth): array
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', $uri, $body, $auth);
        self::$em->clear();

        return $r;
    }

    private function eventCount(Calendar $calendar): int
    {
        return (int) self::$em->createQueryBuilder()->select('COUNT(e.id)')->from(Event::class, 'e')
            ->where('e.calendar = :c')->setParameter('c', $calendar->getId())->getQuery()->getSingleScalarResult();
    }

    private function locationCount(Calendar $calendar): int
    {
        return (int) self::$em->createQueryBuilder()->select('COUNT(l.id)')->from(Location::class, 'l')
            ->where('l.club = :c')->setParameter('c', $calendar->getClub()->getId())->getQuery()->getSingleScalarResult();
    }

    // --- externalUid ---

    public function testImportStoresTheExternalUid(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $r = $this->post("$base/events/import", ['events' => [
            $this->event(['externalUid' => '  abc-123@example.org ']),
            $this->event(['name' => 'Ohne UID']),
        ]], $auth);
        $this->assertSame(201, $r['status'], $r['content']);
        $events = TestHelper::jsonRequest(self::$client, 'GET', "$base/events", [], $auth)['body'];
        $byName = array_column($events, 'externalUid', 'name');
        $this->assertSame('abc-123@example.org', $byName['Training']);
        $this->assertNull($byName['Ohne UID']);
        // Not settable through the normal form endpoints
        $id = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $this->event(['externalUid' => 'x']), $auth)['body']['id'];
        $this->assertNull(self::$em->find(Event::class, $id)?->getExternalUid());
    }

    // --- preview ---

    public function testPreviewReportsNewDuplicateAndInvalidEntriesAndWritesNothing(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $byUid = TestHelper::createEvent(self::$em, $cal, ['name' => 'Sommerfest', 'date' => '2026-07-04']);
        $byUid->setExternalUid('fest-1@example.org');
        $byName = TestHelper::createEvent(self::$em, $cal, ['name' => 'Training Luftgewehr', 'date' => '2026-10-08']);
        $exported = TestHelper::createEvent(self::$em, $cal, ['name' => 'Herbstfest', 'date' => '2026-10-24']);
        self::$em->flush();
        $ids = [$byUid->getId(), $byName->getId(), $exported->getId()];
        self::$em->clear();

        $r = $this->post("$base/events/import/preview", ['events' => [
            $this->event(['name' => 'Neu', 'externalUid' => 'neu@example.org']),
            // same UID (moved to another day): still the same event
            $this->event(['name' => 'Sommerfest (verschoben)', 'date' => '2026-07-11', 'externalUid' => 'fest-1@example.org']),
            // same name and day, case / white space / leading property icons ignored
            $this->event(['name' => "  🎯 training LUFTGEWEHR\u{00A0}", 'date' => '2026-10-08']),
            // the UID our own ICS export writes
            $this->event(['name' => 'Anders', 'date' => '2026-01-01', 'externalUid' => "event-{$ids[2]}@club-calendar"]),
            $this->event(['date' => '2026-02-30']),
            $this->event(['name' => '']),
            'kein-objekt',
            // same name, other day: new
            $this->event(['name' => 'Training Luftgewehr', 'date' => '2026-10-15']),
        ]], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $rows = $r['body']['events'];
        $this->assertSame(['new', 'duplicate', 'duplicate', 'duplicate', 'invalid', 'invalid', 'invalid', 'new'], array_column($rows, 'status'));
        $this->assertSame(range(0, 7), array_column($rows, 'index'));
        $this->assertSame(['id' => $ids[0], 'name' => 'Sommerfest', 'date' => '2026-07-04', 'rule' => 'externalUid'], $rows[1]['duplicate']);
        $this->assertSame(['id' => $ids[1], 'name' => 'Training Luftgewehr', 'date' => '2026-10-08', 'rule' => 'nameDate'], $rows[2]['duplicate']);
        $this->assertSame('externalUid', $rows[3]['duplicate']['rule']);
        $this->assertSame($ids[2], $rows[3]['duplicate']['id']);
        $this->assertSame([['field' => 'events[4].date', 'code' => 'validation_failed', 'message' => 'events[4]: Invalid date (expected YYYY-MM-DD)']], $rows[4]['errors']);
        $this->assertSame('events[5].name', $rows[5]['errors'][0]['field']);
        $this->assertSame('events[6]', $rows[6]['errors'][0]['field']);
        $this->assertSame(['total' => 8, 'new' => 2, 'duplicate' => 3, 'invalid' => 3], $r['body']['summary']);
        $this->assertSame([], $r['body']['warnings']);
        $this->assertSame(3, $this->eventCount($cal), 'the preview stores nothing');
    }

    public function testPreviewChecksReferencesOfThisCalendarOnly(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal, 'user' => $user] = $this->setupCalendar();
        $otherClub = TestHelper::createClub(self::$em, self::$em->find(\App\Entity\User::class, $user->getId()), 'Fremd');
        $foreignTg = TestHelper::jsonRequest(self::$client, 'POST', "/api/clubs/{$otherClub->getId()}/target-groups", ['name' => 'Fremd'], $auth)['body']['id'];
        $ownTg = TestHelper::jsonRequest(self::$client, 'POST', TestHelper::clubBase(self::$em, $base).'/target-groups', ['name' => 'Jugend'], $auth)['body']['id'];
        self::$em->clear();

        $r = $this->post("$base/events/import/preview", [
            'locations' => [['tempId' => 'p1', 'name' => 'Gasthof Zur Linde']],
            'events' => [
                $this->event(['targetGroupIds' => [$foreignTg]]),
                $this->event(['targetGroupIds' => [$ownTg], 'locationTempId' => 'p1']),
                $this->event(['locationTempId' => 'gibt-es-nicht']),
            ],
        ], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $rows = $r['body']['events'];
        $this->assertSame(['invalid', 'new', 'invalid'], array_column($rows, 'status'));
        $this->assertSame('unknown_reference', $rows[0]['errors'][0]['code']);
        $this->assertSame('events[0].targetGroupIds', $rows[0]['errors'][0]['field']);
        $this->assertStringNotContainsString('Fremd', $r['content']);
        $this->assertSame('events[2].locationTempId', $rows[2]['errors'][0]['field']);
        $this->assertSame(0, $this->locationCount($cal), 'the preview creates no places');
    }

    public function testPreviewAndImportNeedMembershipAndAnActiveCalendar(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $stranger = TestHelper::authHeader(TestHelper::createUser(self::$em, self::$hasher), self::$tokens);
        foreach (['/events/import/preview', '/events/import'] as $path) {
            $r = $this->post($base.$path, ['events' => [$this->event()]], $stranger);
            $this->assertSame(403, $r['status'], $path);
            $r = $this->post($base.$path, ['events' => [$this->event()]], '');
            $this->assertContains($r['status'], [401, 403], $path);
        }
        self::$em->find(Calendar::class, $cal->getId())?->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
        foreach (['/events/import/preview', '/events/import'] as $path) {
            $r = $this->post($base.$path, ['events' => [$this->event()]], $auth);
            $this->assertSame(403, $r['status'], $path);
        }
        $this->assertSame(0, $this->eventCount($cal));
    }

    public function testPreviewRunsTheSameNumberOfQueriesForMoreEntries(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $tg = TestHelper::jsonRequest(self::$client, 'POST', TestHelper::clubBase(self::$em, $base).'/target-groups', ['name' => 'Jugend'], $auth)['body']['id'];
        $prop = TestHelper::jsonRequest(self::$client, 'POST', $base.'/properties', ['name' => 'Draußen'], $auth)['body']['id'];
        $loc = TestHelper::jsonRequest(self::$client, 'POST', TestHelper::clubBase(self::$em, $base).'/locations', ['name' => 'Halle'], $auth)['body']['id'];
        TestHelper::createEvent(self::$em, $cal);
        self::$em->clear();
        $entries = fn (int $n) => array_map(fn ($i) => $this->event([
            'date' => sprintf('2026-11-%02d', $i % 28 + 1), 'targetGroupIds' => [$tg], 'propertyIds' => [$prop], 'locationId' => $loc,
        ]), range(1, $n));

        QueryCounter::$count = 0;
        $this->post("$base/events/import/preview", ['events' => $entries(2)], $auth);
        $few = QueryCounter::$count;
        QueryCounter::$count = 0;
        $r = $this->post("$base/events/import/preview", ['events' => $entries(40)], $auth);
        $this->assertSame(40, $r['body']['summary']['new']);
        $this->assertSame($few, QueryCounter::$count, 'no query per entry');
    }

    // --- atomic import ---

    public function testImportCreatesPlacesAndEventsInOneGo(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $existing = TestHelper::jsonRequest(self::$client, 'POST', TestHelper::clubBase(self::$em, $base).'/locations', ['name' => 'Schützenhaus'], $auth)['body']['id'];
        self::$em->clear();

        $r = $this->post("$base/events/import", [
            'locations' => [
                ['tempId' => 'new-1', 'name' => 'Gasthof Zur Linde', 'city' => 'Waldblick'],
                ['tempId' => 'new-2', 'name' => 'Festzelt'],
            ],
            'events' => [
                $this->event(['name' => 'A', 'locationTempId' => 'new-1']),
                $this->event(['name' => 'B', 'locationTempId' => 'new-1']),
                $this->event(['name' => 'C', 'locationId' => $existing]),
                $this->event(['name' => 'D', 'locationTempId' => 'new-2', 'externalUid' => 'd@example.org']),
            ],
        ], $auth);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame(4, $r['body']['imported']);
        $this->assertSame(0, $r['body']['skipped']);
        $this->assertCount(4, $r['body']['ids']);
        $this->assertSame(['new-1', 'new-2'], array_column($r['body']['createdLocations'], 'tempId'));
        $placeIds = array_column($r['body']['createdLocations'], 'id', 'tempId');

        $events = TestHelper::jsonRequest(self::$client, 'GET', "$base/events", [], $auth)['body'];
        $locationOf = array_column($events, 'locationId', 'name');
        $this->assertSame($placeIds['new-1'], $locationOf['A']);
        $this->assertSame($placeIds['new-1'], $locationOf['B']);
        $this->assertSame($existing, $locationOf['C']);
        $this->assertSame($placeIds['new-2'], $locationOf['D']);
        $this->assertEqualsCanonicalizing($r['body']['ids'], array_column($events, 'id'));
        $this->assertSame('Waldblick', self::$em->find(Location::class, $placeIds['new-1'])?->getCity());
        $this->assertSame(3, $this->locationCount($cal));

        // The frontend derives the tempId from the place name ("new:<normalized name>"): a long LOCATION of
        // the file (up to the 255 characters of a name) must not fail the preview or the import
        $name = str_repeat('Schützenhaus İnnenhof ', 11).'Halle';
        $this->assertLessThanOrEqual(255, mb_strlen($name));
        $tempId = 'new:'.mb_strtolower($name);
        $body = ['locations' => [['tempId' => $tempId, 'name' => $name]], 'events' => [$this->event(['name' => 'Lang', 'locationTempId' => $tempId])]];
        $this->assertSame(200, $this->post("$base/events/import/preview", $body, $auth)['status']);
        $r = $this->post("$base/events/import", $body, $auth);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame($tempId, $r['body']['createdLocations'][0]['tempId']);
    }

    public function testAFailingEntryStoresNothingAtAll(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $events = array_map(fn ($i) => $this->event(['name' => "T$i", 'locationTempId' => 'p']), range(1, 700));
        $events[650]['timeEnd'] = '25:00';

        $r = $this->post("$base/events/import", ['locations' => [['tempId' => 'p', 'name' => 'Linde']], 'events' => $events], $auth);
        $this->assertSame(400, $r['status']);
        $this->assertSame('validation_failed', $r['body']['code']);
        $this->assertSame('events[650].timeEnd', $r['body']['field']);
        $this->assertStringStartsWith('events[650]: ', $r['body']['detail']);
        $this->assertSame(0, $this->eventCount($cal), 'no earlier events');
        $this->assertSame(0, $this->locationCount($cal), 'no places');

        // A foreign / unknown reference is a 422 with the entry's field
        $r = $this->post("$base/events/import", ['events' => [$this->event(), $this->event(['locationTempId' => 'x'])]], $auth);
        $this->assertSame(422, $r['status']);
        $this->assertSame('unknown_reference', $r['body']['code']);
        $this->assertSame('events[1].locationTempId', $r['body']['field']);
        // Invalid places and tempIds
        foreach ([
            [['name' => 'ohne tempId']],
            [['tempId' => 'a'], ['tempId' => 'a']],
            [['tempId' => 'a', 'zip' => str_repeat('1', 21)]],
            ['kein-objekt'],
        ] as $n => $locations) {
            $r = $this->post("$base/events/import", ['locations' => $locations, 'events' => [$this->event()]], $auth);
            $this->assertSame(400, $r['status'], "case $n: ".$r['content']);
            $this->assertStringStartsWith('locations[', (string) $r['body']['field']);
        }
        $r = $this->post("$base/events/import", ['events' => [$this->event(['locationId' => 'x', 'locationTempId' => 'a'])], 'locations' => [['tempId' => 'a']]], $auth);
        $this->assertSame(400, $r['status']);
        $this->assertSame(0, $this->eventCount($cal));
        $this->assertSame(0, $this->locationCount($cal));
    }

    public function testSkipDuplicatesSkipsEventsTheCalendarAlreadyHas(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $first = $this->post("$base/events/import", ['events' => [
            $this->event(['name' => 'A', 'externalUid' => 'a@x']),
            $this->event(['name' => 'B', 'date' => '2026-10-02']),
        ]], $auth);
        $this->assertSame(2, $first['body']['imported']);

        $again = ['events' => [
            $this->event(['name' => 'A (umbenannt)', 'externalUid' => 'a@x']),
            $this->event(['name' => ' b ', 'date' => '2026-10-02']),
            $this->event(['name' => 'C']),
        ]];
        $r = $this->post("$base/events/import", $again + ['skipDuplicates' => true], $auth);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame(['imported' => 1, 'skipped' => 2], ['imported' => $r['body']['imported'], 'skipped' => $r['body']['skipped']]);
        $this->assertCount(1, $r['body']['ids']);
        $this->assertSame(3, $this->eventCount($cal));

        // New places are only created for imported events (not for skipped or unused ones)
        $r = $this->post("$base/events/import", [
            'skipDuplicates' => true,
            'locations' => [['tempId' => 'skipped', 'name' => 'Nur Duplikat'], ['tempId' => 'unused', 'name' => 'Ungenutzt']],
            'events' => [$this->event(['name' => 'A', 'externalUid' => 'a@x', 'locationTempId' => 'skipped'])],
        ], $auth);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame(['imported' => 0, 'skipped' => 1, 'createdLocations' => []], ['imported' => $r['body']['imported'], 'skipped' => $r['body']['skipped'], 'createdLocations' => $r['body']['createdLocations']]);
        $this->assertSame(0, $this->locationCount($cal));

        // Default: duplicates are imported (the review decides what is sent)
        $r = $this->post("$base/events/import", $again, $auth);
        $this->assertSame(3, $r['body']['imported']);
        $this->assertSame(0, $r['body']['skipped']);
        // An invalid entry fails even when it would be skipped
        $r = $this->post("$base/events/import", ['skipDuplicates' => true, 'events' => [$this->event(['name' => 'A', 'externalUid' => 'a@x', 'timeBegin' => 'abends'])]], $auth);
        $this->assertSame(400, $r['status']);
        $r = $this->post("$base/events/import", ['skipDuplicates' => 'ja', 'events' => [$this->event()]], $auth);
        $this->assertSame(400, $r['status']);
    }

    public function testOutdatedTimezonesFallBackToTheCalendarZoneWithAWarning(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $body = ['events' => [
            $this->event(['name' => 'Pacific', 'timezone' => 'US/Pacific-New']),
            $this->event(['name' => 'Windows', 'timezone' => 'W. Europe Standard Time']),
            $this->event(['name' => 'Alias', 'timezone' => 'US/Pacific']),
            $this->event(['name' => 'Ohne', 'timezone' => null]),
        ]];
        $preview = $this->post("$base/events/import/preview", $body, $auth);
        $this->assertSame(200, $preview['status']);
        $this->assertSame(4, $preview['body']['summary']['new']);
        $this->assertSame([0, 1], array_column($preview['body']['warnings'], 'index'));

        $r = $this->post("$base/events/import", $body, $auth);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame(4, $r['body']['imported']);
        $this->assertSame([
            'index' => 0, 'field' => 'timezone', 'code' => 'timezone_replaced',
            'message' => 'Unknown time zone "US/Pacific-New" replaced by Europe/Vienna',
            'value' => 'US/Pacific-New', 'replacement' => 'Europe/Vienna',
        ], $r['body']['warnings'][0]);
        $this->assertSame('W. Europe Standard Time', $r['body']['warnings'][1]['value']);
        $zones = array_column(TestHelper::jsonRequest(self::$client, 'GET', "$base/events", [], $auth)['body'], 'timezone', 'name');
        $this->assertSame(['Pacific' => 'Europe/Vienna', 'Windows' => 'Europe/Vienna', 'Alias' => 'US/Pacific', 'Ohne' => null], $zones);
        // Not a string: still a validation error
        $r = $this->post("$base/events/import", ['events' => [$this->event(['timezone' => 42])]], $auth);
        $this->assertSame(400, $r['status']);
        $this->assertSame('events[0].timezone', $r['body']['field']);
    }

    public function testTooManyEventsAreRejectedWithAStableCode(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $events = array_fill(0, 5001, ['name' => 'x']);
        foreach (['/events/import/preview', '/events/import'] as $path) {
            $r = $this->post($base.$path, ['events' => $events], $auth);
            $this->assertSame(413, $r['status'], $path);
            $this->assertSame('too_many_events', $r['body']['code']);
            $this->assertSame('events', $r['body']['field']);
        }
        foreach ([[], ['events' => []], ['events' => 'x'], ['events' => ['a' => $this->event()]]] as $body) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/import", $body, $auth);
            $this->assertSame(400, $r['status'], json_encode($body));
        }
        $this->assertSame(0, $this->eventCount($cal));
    }

    public function testFiveThousandEventsImportInOneRequest(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $tg = TestHelper::jsonRequest(self::$client, 'POST', TestHelper::clubBase(self::$em, $base).'/target-groups', ['name' => 'Jugend'], $auth)['body']['id'];
        $events = array_map(fn ($i) => $this->event([
            'name' => "Termin $i", 'date' => sprintf('2027-%02d-%02d', $i % 12 + 1, $i % 28 + 1), 'targetGroupIds' => [$tg], 'locationTempId' => 'p',
        ]), range(1, 5000));
        $r = $this->post("$base/events/import", ['events' => $events, 'locations' => [['tempId' => 'p', 'name' => 'Halle']]], $auth);
        $this->assertSame(201, $r['status'], substr($r['content'], 0, 500));
        $this->assertSame(5000, $r['body']['imported']);
        $this->assertSame(5000, $this->eventCount($cal));
    }
}
