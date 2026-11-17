<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarMember;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\Resource;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Service\Quota;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class CalendarMemberTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $admin;
    private User $member;
    private User $plain;
    private User $outsider;
    private Club $club;
    private Calendar $cal;
    private Calendar $other;

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
        $this->club = TestHelper::createClub(self::$em, $this->admin);
        $this->cal = TestHelper::createCalendar(self::$em, $this->club, 'Main');
        $this->other = TestHelper::createCalendar(self::$em, $this->club, 'Other');
        $this->member = TestHelper::createUser(self::$em, self::$hasher, 'member@example.com');
        TestHelper::addMember(self::$em, $this->club, $this->member, ClubRole::MEMBER);
        $this->plain = TestHelper::createUser(self::$em, self::$hasher, 'plain@example.com');
        TestHelper::addMember(self::$em, $this->club, $this->plain, ClubRole::MEMBER);
        $this->outsider = TestHelper::createUser(self::$em, self::$hasher, 'outsider@example.com');
    }

    protected function tearDown(): void
    {
        // keep the kernel alive across tests
    }

    private function req(User $who, string $method, string $uri, array $body = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $body, TestHelper::authHeader($who, self::$tokens));
    }

    private function grant(User $user, ?Calendar $cal = null): void
    {
        $this->req($this->admin, 'POST', '/api/calendars/'.($cal ?? $this->cal)->getId().'/members', ['userId' => $user->getId()]);
    }

    public function testAdminManagesCalendarMembers(): void
    {
        $base = '/api/calendars/'.$this->cal->getId().'/members';
        $this->assertSame([], $this->req($this->admin, 'GET', $base)['body']);

        $r = $this->req($this->admin, 'POST', $base, ['userId' => $this->member->getId()]);
        $this->assertSame(201, $r['status']);
        $this->assertSame($this->member->getId(), $r['body']['userId']);
        $this->assertSame('member@example.com', $r['body']['email']);
        $this->assertSame('member', $r['body']['clubRole']);

        // idempotent
        $this->assertSame(200, $this->req($this->admin, 'POST', $base, ['userId' => $this->member->getId()])['status']);
        // any club role may be added
        $this->assertSame(201, $this->req($this->admin, 'POST', $base, ['userId' => $this->admin->getId()])['status']);

        $list = $this->req($this->admin, 'GET', $base)['body'];
        $this->assertCount(2, $list);
        $this->assertEqualsCanonicalizing(['userId', 'name', 'email', 'clubRole', 'createdAt'], array_keys($list[0]));

        $this->assertSame(200, $this->req($this->admin, 'DELETE', $base.'/'.$this->member->getId())['status']);
        $this->assertSame(200, $this->req($this->admin, 'DELETE', $base.'/'.$this->member->getId())['status']);
        $this->assertCount(1, $this->req($this->admin, 'GET', $base)['body']);
    }

    public function testOnlyClubMembersCanBeAdded(): void
    {
        $base = '/api/calendars/'.$this->cal->getId().'/members';
        foreach ([$this->outsider->getId(), '00000000-0000-7000-8000-000000000000', 'nope'] as $id) {
            $r = $this->req($this->admin, 'POST', $base, ['userId' => $id]);
            $this->assertSame(422, $r['status']);
            $this->assertSame('unknown_reference', $r['body']['code']);
            $this->assertSame('userId', $r['body']['field']);
        }
        $this->assertSame(400, $this->req($this->admin, 'POST', $base, [])['status']);
    }

    public function testCalendarMemberCannotManagePermissions(): void
    {
        $this->grant($this->member);
        $base = '/api/calendars/'.$this->cal->getId().'/members';
        $this->assertSame(403, $this->req($this->member, 'GET', $base)['status']);
        $this->assertSame(403, $this->req($this->member, 'POST', $base, ['userId' => $this->plain->getId()])['status']);
        $this->assertSame(403, $this->req($this->member, 'DELETE', $base.'/'.$this->member->getId())['status']);
        $this->assertSame(403, $this->req($this->outsider, 'GET', $base)['status']);
        // editors do not manage them either
        $editor = TestHelper::createUser(self::$em, self::$hasher, 'editor@example.com');
        TestHelper::addMember(self::$em, self::$em->find(Club::class, $this->club->getId()), $editor, ClubRole::EDITOR);
        $this->assertSame(403, $this->req($editor, 'GET', $base)['status']);
    }

    public function testQuota(): void
    {
        $limit = Quota::LIMITS[Quota::CALENDAR_MEMBERS_PER_CALENDAR];
        $conn = self::$em->getConnection();
        $conn->executeStatement('SET FOREIGN_KEY_CHECKS=0');
        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        for ($i = 1; $i <= $limit; ++$i) {
            $conn->insert('calendar_member', ['id' => sprintf('00000000-0000-7000-8001-%012d', $i), 'calendar_id' => $this->cal->getId(), 'user_id' => sprintf('00000000-0000-7000-8000-%012d', $i), 'created_at' => $now, 'updated_at' => $now]);
        }
        $conn->executeStatement('SET FOREIGN_KEY_CHECKS=1');
        $r = $this->req($this->admin, 'POST', '/api/calendars/'.$this->cal->getId().'/members', ['userId' => $this->member->getId()]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('quota_exceeded', $r['body']['code']);
        $this->assertSame(Quota::CALENDAR_MEMBERS_PER_CALENDAR, $r['body']['resource']);
    }

    /** @return iterable<string, array{string, string, bool}> */
    public static function routes(): iterable
    {
        // method, uri ({cal} the granted calendar, {club}), allowed for a plain member WITH a row on {cal}
        yield 'read calendar' => ['GET', '/api/clubs/{club}/calendars/{cal}', true];
        yield 'read events' => ['GET', '/api/calendars/{cal}/events', true];
        yield 'read ics' => ['GET', '/api/calendars/{cal}/events.ics', true];
        yield 'write event' => ['POST', '/api/calendars/{cal}/events', true];
        yield 'conflicts' => ['POST', '/api/calendars/{cal}/events/conflicts', true];
        yield 'from template' => ['POST', '/api/calendars/{cal}/events/from-template', true];
        yield 'bulk' => ['POST', '/api/calendars/{cal}/events/bulk', true];
        yield 'import preview' => ['POST', '/api/calendars/{cal}/events/import/preview', true];
        yield 'import' => ['POST', '/api/calendars/{cal}/events/import', true];
        yield 'series preview' => ['POST', '/api/calendars/{cal}/events/series/preview', true];
        yield 'series' => ['POST', '/api/calendars/{cal}/events/series', true];
        yield 'read series' => ['GET', '/api/calendars/{cal}/event-series/{series}', true];
        yield 'change series' => ['PATCH', '/api/calendars/{cal}/event-series/{series}', true];
        yield 'read templates' => ['GET', '/api/calendars/{cal}/templates', true];
        yield 'write template' => ['POST', '/api/calendars/{cal}/templates', true];
        yield 'read properties' => ['GET', '/api/calendars/{cal}/properties', true];
        yield 'write property' => ['POST', '/api/calendars/{cal}/properties', true];
        yield 'read features' => ['GET', '/api/calendars/{cal}/features', true];
        yield 'write feature' => ['POST', '/api/calendars/{cal}/features', true];
        yield 'read holiday calendars' => ['GET', '/api/calendars/{cal}/holiday-calendars', true];
        yield 'read holiday events' => ['GET', '/api/calendars/{cal}/holiday-events', true];
        yield 'read locations' => ['GET', '/api/clubs/{club}/locations', true];
        yield 'read target groups' => ['GET', '/api/clubs/{club}/target-groups', true];
        yield 'list calendars' => ['GET', '/api/clubs/{club}/calendars', true];

        yield 'write holiday calendar' => ['POST', '/api/calendars/{cal}/holiday-calendars', false];
        yield 'predefined holiday calendar' => ['POST', '/api/calendars/{cal}/holiday-calendars/predefined', false];
        yield 'change holiday calendar' => ['PATCH', '/api/calendars/{cal}/holiday-calendars/{hc}', false];
        yield 'delete holiday calendar' => ['DELETE', '/api/calendars/{cal}/holiday-calendars/{hc}', false];
        yield 'refresh holiday calendar' => ['POST', '/api/calendars/{cal}/holiday-calendars/{hc}/refresh', false];
        yield 'write location' => ['POST', '/api/clubs/{club}/locations', false];
        yield 'write target group' => ['POST', '/api/clubs/{club}/target-groups', false];
        yield 'rename calendar' => ['PATCH', '/api/clubs/{club}/calendars/{cal}', false];
        yield 'create calendar' => ['POST', '/api/clubs/{club}/calendars', false];
        yield 'archive calendar' => ['POST', '/api/clubs/{club}/calendars/{cal}/archive', false];
        yield 'duplicate calendar' => ['POST', '/api/clubs/{club}/calendars/{cal}/duplicate', false];
        yield 'delete calendar' => ['DELETE', '/api/clubs/{club}/calendars/{cal}', false];
        yield 'calendar members' => ['GET', '/api/calendars/{cal}/members', false];
        yield 'read feeds' => ['GET', '/api/clubs/{club}/feeds', false];
        yield 'write feed' => ['POST', '/api/clubs/{club}/feeds', false];
        yield 'club members' => ['GET', '/api/clubs/{club}/members', false];
        yield 'club settings' => ['PATCH', '/api/clubs/{club}', false];
        yield 'invitations' => ['GET', '/api/clubs/{club}/invitations', false];
        yield 'write resource' => ['POST', '/api/clubs/{club}/resources', false];
    }

    #[DataProvider('routes')]
    public function testCalendarMemberAbilitiesPerRoute(string $method, string $uri, bool $allowed): void
    {
        $this->grant($this->member);
        $hc = new \App\Entity\HolidayCalendar(self::$em->find(Calendar::class, $this->cal->getId()), 'HC', 'https://example.com/a.ics');
        self::$em->persist($hc);
        self::$em->flush();
        $uri = strtr($uri, [
            '{club}' => $this->club->getId(),
            '{cal}' => $this->cal->getId(),
            '{hc}' => $hc->getId(),
            '{series}' => '00000000-0000-7000-8000-000000000000',
        ]);
        $r = $this->req($this->member, $method, $uri);
        if ($allowed) {
            $this->assertNotSame(403, $r['status'], "$method $uri: ".$r['content']);
        } else {
            $this->assertSame(403, $r['status'], "$method $uri: ".$r['content']);
        }

        // the same route on the calendar WITHOUT a row is closed for the plain member, whatever it is
        $uriOther = str_replace($this->cal->getId(), $this->other->getId(), $uri);
        if (str_contains($uri, '/calendars/'.$this->cal->getId()) || str_contains($uri, '/api/calendars/')) {
            $this->assertSame(403, $this->req($this->member, $method, $uriOther)['status'], "other calendar $method $uriOther");
        }
        // a member without any row is closed everywhere
        $this->assertSame(403, $this->req($this->plain, $method, $uri)['status'], "no row $method $uri");
    }

    /** Router templates a plain member WITH a row may reach (on the calendar they hold it for); everything else must stay 403. */
    private const array ROW_ALLOWED = [
        'GET /api/clubs/{clubId}', 'DELETE /api/clubs/{clubId}/members/{userId}',
        'GET /api/clubs/{clubId}/my-subscription', 'PUT /api/clubs/{clubId}/my-subscription', 'POST /api/clubs/{clubId}/my-subscription/rotate-secret',
        'GET /api/clubs/{clubId}/my-feeds', 'GET /api/clubs/{clubId}/my-events', 'GET /api/clubs/{clubId}/my-events/{eventId}',
        'GET /api/clubs/{clubId}/resources', 'GET /api/clubs/{clubId}/resources/{id}/events',
        'GET /api/clubs/{clubId}/calendars', 'GET /api/clubs/{clubId}/calendars/{calendarId}',
        'GET /api/clubs/{clubId}/locations', 'GET /api/clubs/{clubId}/target-groups',
        'GET /api/calendars/{calendarId}/events.ics', 'GET /api/calendars/{calendarId}/events.pdf',
        'GET /api/calendars/{calendarId}/events', 'POST /api/calendars/{calendarId}/events',
        'POST /api/calendars/{calendarId}/events/from-template', 'POST /api/calendars/{calendarId}/events/series/preview',
        'POST /api/calendars/{calendarId}/events/series', 'POST /api/calendars/{calendarId}/events/import/preview',
        'POST /api/calendars/{calendarId}/events/import', 'POST /api/calendars/{calendarId}/events/bulk',
        'POST /api/calendars/{calendarId}/events/conflicts', 'GET /api/calendars/{calendarId}/events/{id}',
        'PATCH /api/calendars/{calendarId}/events/{id}', 'DELETE /api/calendars/{calendarId}/events/{id}',
        'GET /api/calendars/{calendarId}/event-series/{seriesId}', 'POST /api/calendars/{calendarId}/event-series/{seriesId}/preview-update',
        'PATCH /api/calendars/{calendarId}/event-series/{seriesId}',
        'GET /api/calendars/{calendarId}/templates', 'POST /api/calendars/{calendarId}/templates', 'GET /api/calendars/{calendarId}/templates/{id}',
        'PATCH /api/calendars/{calendarId}/templates/{id}', 'DELETE /api/calendars/{calendarId}/templates/{id}',
        'GET /api/calendars/{calendarId}/properties', 'POST /api/calendars/{calendarId}/properties',
        'PATCH /api/calendars/{calendarId}/properties/{id}', 'DELETE /api/calendars/{calendarId}/properties/{id}',
        'GET /api/calendars/{calendarId}/features', 'POST /api/calendars/{calendarId}/features',
        'PATCH /api/calendars/{calendarId}/features/{id}', 'DELETE /api/calendars/{calendarId}/features/{id}',
        'GET /api/calendars/{calendarId}/holiday-calendars', 'GET /api/calendars/{calendarId}/holiday-events',
    ];

    public function testRowHolderIsDeniedOnEveryRouteOutsideTheAllowList(): void
    {
        $this->grant($this->member);
        $routes = static::getContainer()->get(\Symfony\Component\Routing\RouterInterface::class)->getRouteCollection();
        $allowedSeen = [];
        $checked = 0;
        foreach ($routes as $route) {
            $path = $route->getPath();
            if (!preg_match('#^/api/(clubs|calendars)/\{([^}]+)\}#', $path)) {
                continue;
            }
            $uri = str_replace(['{clubId}', '{calendarId}'], [$this->club->getId(), $this->cal->getId()], $path);
            $uri = preg_replace('/\{[^}]+\}/', '00000000-0000-7000-8000-000000000000', $uri);
            foreach ($route->getMethods() ?: ['GET'] as $method) {
                if (in_array($method, ['OPTIONS', 'HEAD'], true)) {
                    continue;
                }
                $key = "$method $path";
                if (in_array($key, self::ROW_ALLOWED, true)) {
                    $allowedSeen[] = $key;
                    continue;
                }
                ++$checked;
                $r = $this->req($this->member, $method, $uri, in_array($method, ['POST', 'PATCH', 'PUT'], true) ? ['name' => 'x'] : []);
                $this->assertSame(403, $r['status'], "calendar member must get 403 on $key, got {$r['status']}");
            }
        }
        $this->assertGreaterThan(40, $checked);
        sort($allowedSeen);
        $expected = self::ROW_ALLOWED;
        sort($expected);
        $this->assertSame($expected, $allowedSeen, 'every allow-list entry must match a real route');
    }

    public function testCalendarMemberCanWorkOnEventsEndToEnd(): void
    {
        $this->grant($this->member);
        $cal = '/api/calendars/'.$this->cal->getId();

        $r = $this->req($this->member, 'POST', $cal.'/events', ['name' => 'Training', 'date' => '2026-07-01', 'timeBegin' => '18:00', 'timeEnd' => '19:00', 'isDraft' => true]);
        $this->assertSame(201, $r['status'], $r['content']);
        $id = $r['body']['id'];
        $this->assertSame(200, $this->req($this->member, 'PATCH', $cal.'/events/'.$id, ['name' => 'Training 2'])['status']);

        // drafts are listed for them
        $list = $this->req($this->member, 'GET', $cal.'/events')['body'];
        $this->assertSame([$id], array_column($list, 'id'));

        $this->assertSame(201, $this->req($this->member, 'POST', $cal.'/properties', ['name' => 'Tracht'])['status']);
        $this->assertSame(201, $this->req($this->member, 'POST', $cal.'/features', ['name' => 'Bonus'])['status']);
        $this->assertSame(200, $this->req($this->member, 'DELETE', $cal.'/events/'.$id)['status']);
    }

    public function testImportMayNotCreateLocationsForCalendarMembers(): void
    {
        $this->grant($this->member);
        $body = ['events' => [], 'locations' => [['tempId' => 't1', 'name' => 'Neu']]];
        $this->assertSame(403, $this->req($this->member, 'POST', '/api/calendars/'.$this->cal->getId().'/events/import', $body)['status']);
        $this->assertSame(0, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM location'));
        $this->assertNotSame(403, $this->req($this->member, 'POST', '/api/calendars/'.$this->cal->getId().'/events/import', ['events' => []])['status']);
        $this->assertNotSame(403, $this->req($this->admin, 'POST', '/api/calendars/'.$this->cal->getId().'/events/import', $body)['status']);
    }

    public function testArchivedCalendarStaysReadOnlyForCalendarMember(): void
    {
        $this->grant($this->member);
        $this->req($this->admin, 'POST', '/api/clubs/'.$this->club->getId().'/calendars/'.$this->cal->getId().'/archive');
        $cal = '/api/calendars/'.$this->cal->getId();
        $this->assertSame(200, $this->req($this->member, 'GET', $cal.'/events')['status']);
        $this->assertSame(403, $this->req($this->member, 'POST', $cal.'/events', ['name' => 'x', 'date' => '2026-07-01'])['status']);
    }

    public function testClubAndCalendarListsForCalendarMembers(): void
    {
        $club = '/api/clubs/'.$this->club->getId();
        // without a row: nothing but the minimal club payload
        $r = $this->req($this->plain, 'GET', $club);
        $this->assertSame([], $r['body']['calendars']);
        $this->assertSame(403, $this->req($this->plain, 'GET', $club.'/calendars')['status']);

        $this->grant($this->member);
        $r = $this->req($this->member, 'GET', $club);
        $this->assertSame(200, $r['status']);
        $this->assertEqualsCanonicalizing(['id', 'name', 'timezone', 'role', 'calendars'], array_keys($r['body']));
        $this->assertSame(['Main'], array_column($r['body']['calendars'], 'name'));

        $r = $this->req($this->member, 'GET', '/api/clubs');
        $this->assertSame(['Main'], array_column($r['body'][0]['calendars'], 'name'));
        $this->assertArrayNotHasKey('calendarCount', $r['body'][0]);

        $r = $this->req($this->member, 'GET', $club.'/calendars');
        $this->assertSame(200, $r['status']);
        $this->assertSame(['Main'], array_column($r['body'], 'name'));
        $this->assertSame(200, $this->req($this->member, 'GET', $club.'/calendars/'.$this->cal->getId())['status']);
        $this->assertSame(403, $this->req($this->member, 'GET', $club.'/calendars/'.$this->other->getId())['status']);

        // staff still see everything
        $this->assertCount(2, $this->req($this->admin, 'GET', $club.'/calendars')['body']);
    }

    public function testLeavingOrRemovalDropsPermissions(): void
    {
        $this->grant($this->member, $this->cal);
        $this->grant($this->member, $this->other);
        $this->grant($this->plain, $this->cal);
        $club = '/api/clubs/'.$this->club->getId();

        $this->assertSame(200, $this->req($this->member, 'DELETE', $club.'/members/'.$this->member->getId())['status']);
        $this->assertSame(200, $this->req($this->admin, 'DELETE', $club.'/members/'.$this->plain->getId())['status']);
        self::$em->clear();
        $this->assertSame(0, self::$em->getRepository(CalendarMember::class)->count([]));
    }

    public function testDeletingCalendarOrUserCascades(): void
    {
        $this->grant($this->member, $this->cal);
        $this->grant($this->plain, $this->other);
        $this->req($this->admin, 'DELETE', '/api/clubs/'.$this->club->getId().'/calendars/'.$this->cal->getId());
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(CalendarMember::class)->count([]));
        self::$em->getConnection()->executeStatement('DELETE FROM club_user WHERE user_id = ?', [$this->plain->getId()]);
        self::$em->getConnection()->executeStatement('DELETE FROM user WHERE id = ?', [$this->plain->getId()]);
        $this->assertSame(0, self::$em->getRepository(CalendarMember::class)->count([]));
    }

    public function testViewerWithRowMayEditThatCalendarButNotHolidays(): void
    {
        $viewer = TestHelper::createUser(self::$em, self::$hasher, 'viewer@example.com');
        TestHelper::addMember(self::$em, self::$em->find(Club::class, $this->club->getId()), $viewer, ClubRole::VIEWER);
        $this->assertSame(403, $this->req($viewer, 'POST', '/api/calendars/'.$this->cal->getId().'/properties', ['name' => 'P'])['status']);
        $this->grant($viewer);
        $this->assertSame(201, $this->req($viewer, 'POST', '/api/calendars/'.$this->cal->getId().'/properties', ['name' => 'P'])['status']);
        $this->assertSame(403, $this->req($viewer, 'POST', '/api/calendars/'.$this->cal->getId().'/holiday-calendars', ['name' => 'x'])['status']);
    }

    public function testConflictCheckHidesEventNamesFromCalendarMembers(): void
    {
        $club = self::$em->find(Club::class, $this->club->getId());
        $loc = TestHelper::createLocation(self::$em, $club, 'Halle');
        $res = new Resource();
        $res->setClub($club);
        $res->setName('Halle');
        $res->setLocation($loc);
        self::$em->persist($res);
        self::$em->flush();
        $this->req($this->admin, 'POST', '/api/calendars/'.$this->other->getId().'/events', [
            'name' => 'Secret Name', 'date' => '2026-07-01', 'timeBegin' => '18:00', 'timeEnd' => '20:00', 'locationId' => $loc->getId(), 'isDraft' => false,
        ]);
        $this->grant($this->member);
        $body = ['date' => '2026-07-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00', 'locationId' => $loc->getId(), 'isDraft' => false];

        $r = $this->req($this->member, 'POST', '/api/calendars/'.$this->cal->getId().'/events/conflicts', $body);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertCount(1, $r['body']['conflicts']);
        $this->assertArrayNotHasKey('eventName', $r['body']['conflicts'][0]);
        $this->assertArrayNotHasKey('eventId', $r['body']['conflicts'][0]);
        $this->assertSame('Other', $r['body']['conflicts'][0]['calendarName']);

        $r = $this->req($this->admin, 'POST', '/api/calendars/'.$this->cal->getId().'/events/conflicts', $body);
        $this->assertSame('Secret Name', $r['body']['conflicts'][0]['eventName']);

        // the blocking publish error hides them too
        $r = $this->req($this->member, 'POST', '/api/calendars/'.$this->cal->getId().'/events', ['name' => 'Mine'] + $body);
        $this->assertSame(422, $r['status']);
        $this->assertSame('resource_conflict', $r['body']['code']);
        $this->assertStringNotContainsString('Secret Name', $r['content']);
        $r = $this->req($this->admin, 'POST', '/api/calendars/'.$this->cal->getId().'/events', ['name' => 'Mine'] + $body);
        $this->assertStringContainsString('Secret Name', $r['content']);
    }

    public function testMembershipRowRequiresClubMembership(): void
    {
        // a stale row of somebody who is not (any more) a club member gives nothing
        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        self::$em->getConnection()->insert('calendar_member', ['id' => '00000000-0000-7000-8001-000000000001', 'calendar_id' => $this->cal->getId(), 'user_id' => $this->outsider->getId(), 'created_at' => $now, 'updated_at' => $now]);
        $this->assertSame(403, $this->req($this->outsider, 'GET', '/api/calendars/'.$this->cal->getId().'/events')['status']);
        $this->assertSame(403, $this->req($this->outsider, 'GET', '/api/clubs/'.$this->club->getId().'/locations')['status']);
        self::$em->clear();
        $this->assertNull(self::$em->getRepository(ClubUser::class)->findOneBy(['user' => $this->outsider->getId()]));
    }
}
