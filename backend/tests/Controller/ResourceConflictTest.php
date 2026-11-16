<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\Location;
use App\Entity\Resource;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class ResourceConflictTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $admin;
    private string $clubId;
    private string $calId;
    private string $cal2Id;
    private string $locId;
    private string $resourceId;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
        $this->admin = TestHelper::createUser(self::$em, self::$hasher, 'admin@example.com');
        $club = TestHelper::createClub(self::$em, $this->admin);
        $this->clubId = $club->getId();
        $this->calId = TestHelper::createCalendar(self::$em, $club, 'Main')->getId();
        $this->cal2Id = TestHelper::createCalendar(self::$em, $club, 'Youth')->getId();
        $location = TestHelper::createLocation(self::$em, $club, 'Hall');
        $this->locId = $location->getId();
        $this->makeResource();
    }

    protected function tearDown(): void
    {
    }

    private function makeResource(bool $double = false, int $buffer = 0, ?string $locId = null): string
    {
        $club = self::$em->getRepository(Club::class)->find($this->clubId);
        $r = (new Resource())
            ->setClub($club)
            ->setName('Hall')
            ->setLocation(self::$em->getRepository(Location::class)->find($locId ?? $this->locId))
            ->setAllowDoubleBooking($double)
            ->setBufferMinutes($buffer);
        self::$em->persist($r);
        self::$em->flush();

        return $this->resourceId = $r->getId();
    }

    private function configure(bool $double, int $buffer): void
    {
        $r = self::$em->getRepository(Resource::class)->find($this->resourceId);
        $r->setAllowDoubleBooking($double)->setBufferMinutes($buffer);
        self::$em->flush();
    }

    private function req(string $method, string $uri, array $body = [], ?User $who = null): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $body, TestHelper::authHeader($who ?? $this->admin, self::$tokens));
    }

    private function event(array $data = [], ?string $cal = null): array
    {
        return $this->req('POST', '/api/calendars/'.($cal ?? $this->calId).'/events', $data + [
            'name' => 'E',
            'date' => '2026-07-01',
            'timeBegin' => '18:00',
            'timeEnd' => '20:00',
            'locationId' => $this->locId,
            'isDraft' => false,
        ]);
    }

    private function check(array $data = [], ?string $cal = null, ?User $who = null): array
    {
        return $this->req('POST', '/api/calendars/'.($cal ?? $this->calId).'/events/conflicts', $data + [
            'date' => '2026-07-01',
            'timeBegin' => '19:00',
            'timeEnd' => '21:00',
            'locationId' => $this->locId,
            'isDraft' => false,
        ], $who);
    }

    public function testPublishedOverlapBlocksPublishedButNotDraft(): void
    {
        $this->assertSame(201, $this->event(['name' => 'First'])['status']);

        $r = $this->event(['name' => 'Second', 'timeBegin' => '19:00', 'timeEnd' => '21:00']);
        $this->assertSame(422, $r['status']);
        $this->assertSame('resource_conflict', $r['body']['code']);
        $c = $r['body']['conflicts'][0];
        $this->assertSame('overlap', $c['kind']);
        $this->assertSame('error', $c['severity']);
        $this->assertSame('Main', $c['calendarName']);
        $this->assertSame('First', $c['eventName']);
        $this->assertFalse($c['isDraft']);

        $this->assertSame(201, $this->event(['name' => 'Draft', 'timeBegin' => '19:00', 'timeEnd' => '21:00', 'isDraft' => true])['status']);
    }

    public function testDoubleBookingAllowedIsOnlyAWarning(): void
    {
        $this->configure(true, 0);
        $this->event();
        $r = $this->check([]);
        $this->assertSame(200, $r['status']);
        $this->assertSame('warning', $r['body']['conflicts'][0]['severity']);
        $this->assertFalse($r['body']['blocking']);
        $this->assertSame(201, $this->event(['timeBegin' => '19:00'])['status']);
    }

    public function testOverlapWithDraftIsWarning(): void
    {
        $this->event(['isDraft' => true]);
        $r = $this->check([]);
        $this->assertSame('warning', $r['body']['conflicts'][0]['severity']);
        $this->assertTrue($r['body']['conflicts'][0]['isDraft']);
        $this->assertFalse($r['body']['blocking']);
        $this->assertSame(201, $this->event(['timeBegin' => '19:00'])['status']);
    }

    public function testDraftCandidateNeverBlocking(): void
    {
        $this->event();
        $r = $this->check(['isDraft' => true]);
        $this->assertSame('warning', $r['body']['conflicts'][0]['severity']);
        $this->assertFalse($r['body']['blocking']);
    }

    public function testBufferIsAlwaysWarning(): void
    {
        $this->configure(false, 30);
        $this->event();

        $r = $this->check(['timeBegin' => '20:15', 'timeEnd' => '21:00']);
        $this->assertCount(1, $r['body']['conflicts']);
        $this->assertSame('buffer', $r['body']['conflicts'][0]['kind']);
        $this->assertSame('warning', $r['body']['conflicts'][0]['severity']);
        $this->assertFalse($r['body']['blocking']);
        $this->assertSame(201, $this->event(['timeBegin' => '20:15', 'timeEnd' => '21:00'])['status']);

        $before = $this->check(['timeBegin' => '16:00', 'timeEnd' => '17:45']);
        $this->assertSame('buffer', $before['body']['conflicts'][0]['kind']);

        $exact = $this->check(['timeBegin' => '21:30', 'timeEnd' => '22:00']);
        $this->assertSame([], $exact['body']['conflicts'], 'a gap equal to the buffer is free');
    }

    public function testAllDayOccupiesWholeDayWithoutBuffer(): void
    {
        $this->configure(false, 60);
        $this->event(['isAllDay' => true, 'timeBegin' => '00:00', 'timeEnd' => '23:59']);

        $r = $this->check(['timeBegin' => '06:00', 'timeEnd' => '07:00']);
        $this->assertSame('overlap', $r['body']['conflicts'][0]['kind']);
        $this->assertTrue($r['body']['conflicts'][0]['isAllDay']);
        $this->assertTrue($r['body']['blocking']);

        $next = $this->check(['date' => '2026-07-02', 'isAllDay' => true, 'timeBegin' => null, 'timeEnd' => null]);
        $this->assertSame([], $next['body']['conflicts'], 'all-day events get no buffer');

        $nextTimed = $this->check(['date' => '2026-07-02', 'timeBegin' => '00:30', 'timeEnd' => '01:00']);
        $this->assertSame('buffer', $nextTimed['body']['conflicts'][0]['kind']);
    }

    public function testMultiDayEvent(): void
    {
        $this->event(['date' => '2026-07-01', 'dateEnd' => '2026-07-03', 'timeBegin' => '18:00', 'timeEnd' => '12:00']);

        $this->assertSame('overlap', $this->check(['date' => '2026-07-02', 'timeBegin' => '03:00', 'timeEnd' => '04:00'])['body']['conflicts'][0]['kind']);
        $this->assertSame('overlap', $this->check(['date' => '2026-07-03', 'timeBegin' => '11:00', 'timeEnd' => '13:00'])['body']['conflicts'][0]['kind']);
        $this->assertSame([], $this->check(['date' => '2026-07-03', 'timeBegin' => '12:00', 'timeEnd' => '13:00'])['body']['conflicts']);
        $this->assertSame([], $this->check(['date' => '2026-07-01', 'timeBegin' => '10:00', 'timeEnd' => '12:00'])['body']['conflicts']);
    }

    public function testTimezonesCompareAsInstants(): void
    {
        $this->event(['timezone' => 'Europe/Berlin', 'timeBegin' => '20:00', 'timeEnd' => '22:00']);

        // 19:00-21:00 UTC = 21:00-23:00 Berlin: overlaps
        $this->assertSame('overlap', $this->check(['timezone' => 'UTC', 'timeBegin' => '19:00', 'timeEnd' => '21:00'])['body']['conflicts'][0]['kind']);
        // 20:00-22:00 UTC = 22:00-24:00 Berlin: free
        $this->assertSame([], $this->check(['timezone' => 'UTC', 'timeBegin' => '20:00', 'timeEnd' => '22:00'])['body']['conflicts']);
    }

    public function testOtherCalendarOfTheClubConflicts(): void
    {
        $this->event([], $this->cal2Id);
        $r = $this->event(['timeBegin' => '19:00']);
        $this->assertSame(422, $r['status']);
        $this->assertSame('Youth', $r['body']['conflicts'][0]['calendarName']);
    }

    public function testOwnEventIsExcluded(): void
    {
        $id = $this->event()['body']['id'];

        $r = $this->check(['eventId' => $id]);
        $this->assertSame([], $r['body']['conflicts']);

        $patch = $this->req('PATCH', "/api/calendars/{$this->calId}/events/$id", ['timeBegin' => '18:30', 'timeEnd' => '19:30']);
        $this->assertSame(200, $patch['status']);
    }

    public function testPatchIntoConflictAndPublishViaPatch(): void
    {
        $this->event();
        $other = $this->event(['date' => '2026-07-02', 'name' => 'Later'])['body']['id'];

        $r = $this->req('PATCH', "/api/calendars/{$this->calId}/events/$other", ['date' => '2026-07-01']);
        $this->assertSame(422, $r['status']);
        $this->assertSame('resource_conflict', $r['body']['code']);
        $this->assertSame($other, $r['body']['conflicts'][0]['forEventId']);

        $draft = $this->event(['date' => '2026-07-01', 'isDraft' => true, 'name' => 'D'])['body']['id'];
        $r = $this->req('PATCH', "/api/calendars/{$this->calId}/events/$draft", ['isDraft' => false]);
        $this->assertSame(422, $r['status']);
        $this->assertSame(200, $this->req('PATCH', "/api/calendars/{$this->calId}/events/$draft", ['name' => 'Renamed'])['status']);
    }

    public function testUnchangedScheduleOfExistingDoubleBookingStaysEditable(): void
    {
        $this->configure(true, 0);
        $a = $this->event()['body']['id'];
        $this->event();
        $this->configure(false, 0);
        $this->assertSame(200, $this->req('PATCH', "/api/calendars/{$this->calId}/events/$a", ['name' => 'Renamed'])['status']);
    }

    public function testSeriesScopeAllLocationChange(): void
    {
        $club = self::$em->getRepository(Club::class)->find($this->clubId);
        $loc2 = TestHelper::createLocation(self::$em, $club, 'Hall 2');
        $this->makeResource(false, 0, $loc2->getId());
        $this->event(['date' => '2026-07-08', 'locationId' => $loc2->getId()]);

        $s = $this->req('POST', "/api/calendars/{$this->calId}/events/series", [
            'rule' => ['frequency' => 'weekly', 'weekday' => 3, 'startDate' => '2026-07-01', 'until' => '2026-07-20', 'skipHolidays' => false],
            'event' => ['name' => 'S', 'timeBegin' => '18:00', 'timeEnd' => '20:00'],
            'isDraft' => false,
        ]);
        $this->assertSame(201, $s['status'], json_encode($s['body']));
        $first = $s['body']['events'][0]['id'];

        $r = $this->req('PATCH', "/api/calendars/{$this->calId}/events/$first", ['scope' => 'all', 'locationId' => $loc2->getId()]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('resource_conflict', $r['body']['code']);
        $this->assertSame('2026-07-08', $r['body']['conflicts'][0]['date']);
    }

    public function testSeriesCreatePublishedConflicts(): void
    {
        $this->event(['date' => '2026-07-08']);
        $body = [
            'rule' => ['frequency' => 'weekly', 'weekday' => 3, 'startDate' => '2026-07-01', 'until' => '2026-07-20', 'skipHolidays' => false],
            'event' => ['name' => 'S', 'timeBegin' => '19:00', 'timeEnd' => '21:00', 'locationId' => $this->locId],
            'isDraft' => false,
        ];
        $r = $this->req('POST', "/api/calendars/{$this->calId}/events/series", $body);
        $this->assertSame(422, $r['status']);
        $this->assertSame('resource_conflict', $r['body']['code']);
        $this->assertSame(1, self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM event'));
        $this->assertSame(0, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM event_series'));

        $body['isDraft'] = true;
        $this->assertSame(201, $this->req('POST', "/api/calendars/{$this->calId}/events/series", $body)['status']);
    }

    public function testSeriesRuleChangeChecksNewEvents(): void
    {
        $rule = ['frequency' => 'weekly', 'weekday' => 3, 'startDate' => '2027-07-07', 'until' => '2027-07-20', 'skipHolidays' => false];
        $s = $this->req('POST', "/api/calendars/{$this->calId}/events/series", ['rule' => $rule, 'event' => ['name' => 'S', 'timeBegin' => '18:00', 'timeEnd' => '20:00', 'locationId' => $this->locId], 'isDraft' => false]);
        $this->assertSame(201, $s['status'], json_encode($s['body']));
        $this->event(['date' => '2027-07-28', 'name' => 'Blocker']);

        $r = $this->req('PATCH', "/api/calendars/{$this->calId}/event-series/{$s['body']['series']['id']}", ['rule' => ['until' => '2027-08-05'] + $rule]);
        $this->assertSame(422, $r['status'], json_encode($r['body']));
        $this->assertSame('resource_conflict', $r['body']['code']);
        $this->assertSame('Blocker', $r['body']['conflicts'][0]['eventName']);
    }

    public function testFromTemplatePublishedConflicts(): void
    {
        $this->event(['date' => '2026-07-08']);
        $template = TestHelper::createTemplate(self::$em, self::$em->getRepository(Calendar::class)->find($this->calId));
        $r = $this->req('POST', "/api/calendars/{$this->calId}/events/from-template", [
            'templateId' => $template->getId(),
            'dates' => ['2026-07-08'],
            'overrides' => ['locationId' => $this->locId, 'isDraft' => false, 'timeBegin' => '18:00', 'timeEnd' => '19:00'],
        ]);
        $this->assertSame(422, $r['status'], json_encode($r['body']));
        $this->assertSame('resource_conflict', $r['body']['code']);
    }

    public function testImportPublishedConflictsAndBatchInternal(): void
    {
        $this->event(['date' => '2026-07-08']);
        $entry = fn (string $date, string $b, string $e) => ['name' => 'I', 'date' => $date, 'timeBegin' => $b, 'timeEnd' => $e, 'locationId' => $this->locId, 'isDraft' => false];

        $r = $this->req('POST', "/api/calendars/{$this->calId}/events/import", ['events' => [$entry('2026-07-08', '19:00', '21:00')]]);
        $this->assertSame(422, $r['status'], json_encode($r['body']));
        $this->assertSame('resource_conflict', $r['body']['code']);

        $r = $this->req('POST', "/api/calendars/{$this->calId}/events/import", ['events' => [$entry('2026-07-09', '18:00', '20:00'), $entry('2026-07-09', '19:00', '21:00')]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame(1, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM event'));

        $r = $this->req('POST', "/api/calendars/{$this->calId}/events/import", ['events' => [$entry('2026-07-09', '18:00', '20:00')]]);
        $this->assertSame(201, $r['status'], json_encode($r['body']));
    }

    public function testBulkPublishIsAllOrNothing(): void
    {
        $this->event(['date' => '2026-07-08', 'name' => 'Published']);
        $d1 = $this->event(['date' => '2026-07-08', 'timeBegin' => '19:00', 'isDraft' => true])['body']['id'];
        $d2 = $this->event(['date' => '2026-07-10', 'isDraft' => true])['body']['id'];

        $r = $this->req('POST', "/api/calendars/{$this->calId}/events/bulk", ['action' => 'publish', 'ids' => [$d1, $d2]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('resource_conflict', $r['body']['code']);
        $this->assertSame($d1, $r['body']['conflicts'][0]['forEventId']);
        $this->assertSame(0, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM event WHERE is_draft = 0 AND id IN (?, ?)', [$d1, $d2]));

        $this->assertSame(200, $this->req('POST', "/api/calendars/{$this->calId}/events/bulk", ['action' => 'publish', 'ids' => [$d2]])['status']);
    }

    public function testBulkPublishConflictsAmongPublishedTogether(): void
    {
        $d1 = $this->event(['isDraft' => true])['body']['id'];
        $d2 = $this->event(['timeBegin' => '19:00', 'isDraft' => true])['body']['id'];
        $r = $this->req('POST', "/api/calendars/{$this->calId}/events/bulk", ['action' => 'publish', 'ids' => [$d1, $d2]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('resource_conflict', $r['body']['code']);
    }

    public function testNoResourceNoCheck(): void
    {
        $club = self::$em->getRepository(Club::class)->find($this->clubId);
        $plain = TestHelper::createLocation(self::$em, $club, 'Plain')->getId();
        $this->assertSame(201, $this->event(['locationId' => $plain])['status']);
        $this->assertSame(201, $this->event(['locationId' => $plain])['status']);
        $this->assertSame([], $this->check(['locationId' => $plain])['body']['conflicts']);
    }

    public function testEndpointPermissions(): void
    {
        $viewer = TestHelper::createUser(self::$em, self::$hasher, 'viewer@example.com');
        TestHelper::addMember(self::$em, self::$em->getRepository(Club::class)->find($this->clubId), $viewer, ClubRole::VIEWER);
        $editor = TestHelper::createUser(self::$em, self::$hasher, 'editor@example.com');
        TestHelper::addMember(self::$em, self::$em->getRepository(Club::class)->find($this->clubId), $editor, ClubRole::EDITOR);

        $this->assertSame(403, $this->check([], null, $viewer)['status']);
        $r = $this->check([], null, $editor);
        $this->assertSame(200, $r['status']);

        $this->event(['name' => 'Secret']);
        $r = $this->check([], null, $editor);
        $this->assertSame('Secret', $r['body']['conflicts'][0]['eventName']);
        $this->assertArrayHasKey('eventId', $r['body']['conflicts'][0]);
        $this->assertArrayNotHasKey('forEventId', $r['body']['conflicts'][0]);

        self::$em->getRepository(Calendar::class)->find($this->calId)->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
        $this->assertSame(403, $this->check()['status'] ?? 0);
    }

    public function testEndpointValidation(): void
    {
        $this->assertSame(400, $this->check(['locationId' => null])['status']);
        $this->assertSame(400, $this->check(['date' => 'nope'])['status']);
        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$this->calId}/events/conflicts", [])['status']);
    }
}
