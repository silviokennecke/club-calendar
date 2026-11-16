<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\Location;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\QueryCounter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class ResourceCalendarTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $admin;
    private Club $club;
    private string $clubId;
    private string $locationId;
    private string $calendarId;

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
        $this->clubId = $this->club->getId();
        $this->locationId = TestHelper::createLocation(self::$em, $this->club, 'Hall')->getId();
        $this->calendarId = TestHelper::createCalendar(self::$em, $this->club, 'Main')->getId();
    }

    protected function tearDown(): void
    {
    }

    private function req(User $who, string $uri): array
    {
        return TestHelper::jsonRequest(self::$client, 'GET', $uri, [], TestHelper::authHeader($who, self::$tokens));
    }

    private function user(ClubRole $role): User
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, $role->value.'@example.com');
        TestHelper::addMember(self::$em, self::$em->getRepository(Club::class)->find($this->clubId), $user, $role);

        return $user;
    }

    private function resource(string $visibility, ?string $locationId = null): string
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/clubs/{$this->clubId}/resources", [
            'name' => 'Hall', 'locationId' => $locationId ?? $this->locationId, 'visibility' => $visibility,
        ], TestHelper::authHeader($this->admin, self::$tokens));
        $this->assertSame(201, $r['status']);

        return $r['body']['id'];
    }

    private function event(string $name, string $date, bool $draft, ?string $calendarId = null, ?string $locationId = null): void
    {
        $calendar = self::$em->getRepository(Calendar::class)->find($calendarId ?? $this->calendarId);
        $event = TestHelper::createEvent(self::$em, $calendar, ['name' => $name, 'date' => $date, 'isDraft' => $draft]);
        $event->setLocation(self::$em->getRepository(Location::class)->find($locationId ?? $this->locationId));
        self::$em->flush();
    }

    private function url(string $id, string $query = 'from=2026-07-01&to=2026-07-31'): string
    {
        return "/api/clubs/{$this->clubId}/resources/$id/events?$query";
    }

    public function testStaffSeesFullItemsAndDraftsOnlyForEditors(): void
    {
        $id = $this->resource('staff');
        $this->event('Pub', '2026-07-02', false);
        $this->event('Draft', '2026-07-03', true);
        $this->event('Elsewhere', '2026-07-04', false, null, TestHelper::createLocation(self::$em, self::$em->getRepository(Club::class)->find($this->clubId), 'Other')->getId());
        $this->event('Out', '2026-08-04', false);

        $viewer = $this->req($this->user(ClubRole::VIEWER), $this->url($id));
        $this->assertSame(200, $viewer['status']);
        $this->assertCount(1, $viewer['body']);
        $this->assertSame('1', self::$client->getResponse()->headers->get('X-Total-Count'));
        $item = $viewer['body'][0];
        $this->assertSame('Pub', $item['name']);
        $this->assertSame('Main', $item['calendarName']);
        $this->assertSame($this->calendarId, $item['calendarId']);
        $this->assertFalse($item['isDraft']);
        foreach (['id', 'date', 'dateEnd', 'timeBegin', 'timeEnd', 'isAllDay', 'timezone'] as $k) {
            $this->assertArrayHasKey($k, $item);
        }

        $editor = $this->req($this->user(ClubRole::EDITOR), $this->url($id));
        $this->assertSame(['Pub', 'Draft'], array_column($editor['body'], 'name'));
        $this->assertSame('2', self::$client->getResponse()->headers->get('X-Total-Count'));
    }

    public function testMemberGetsBusyOnlyItemsOfMembersResource(): void
    {
        $id = $this->resource('members');
        $this->event('Pub', '2026-07-02', false);
        $this->event('Draft', '2026-07-03', true);

        $r = $this->req($this->user(ClubRole::MEMBER), $this->url($id));
        $this->assertSame(200, $r['status']);
        $this->assertCount(1, $r['body']);
        $this->assertSame(['calendarName', 'date', 'dateEnd', 'isAllDay', 'timeBegin', 'timeEnd', 'timezone'], $this->sorted($r['body'][0]));
    }

    private function sorted(array $a): array
    {
        $k = array_keys($a);
        sort($k);

        return $k;
    }

    public function testMemberCannotSeeStaffOnlyOrUnknownResource(): void
    {
        $hidden = $this->resource('staff');
        $member = $this->user(ClubRole::MEMBER);

        foreach ([$hidden, '00000000-0000-7000-8000-000000000000'] as $id) {
            $r = $this->req($member, $this->url($id));
            $this->assertSame(404, $r['status']);
            $this->assertSame('resource_not_found', $r['body']['code']);
        }
    }

    public function testListForMemberIsMinimalAndFiltered(): void
    {
        $this->resource('staff');
        $visible = $this->resource('members', TestHelper::createLocation(self::$em, self::$em->getRepository(Club::class)->find($this->clubId), 'Open')->getId());

        $r = $this->req($this->user(ClubRole::MEMBER), "/api/clubs/{$this->clubId}/resources");
        $this->assertSame(200, $r['status']);
        $this->assertCount(1, $r['body']);
        $this->assertSame($visible, $r['body'][0]['id']);
        $this->assertSame(['id', 'locationId', 'name', 'type'], $this->sorted($r['body'][0]));

        $full = $this->req($this->user(ClubRole::VIEWER), "/api/clubs/{$this->clubId}/resources");
        $this->assertCount(2, $full['body']);
        $this->assertArrayHasKey('visibility', $full['body'][0]);
    }

    public function testRangeValidation(): void
    {
        $id = $this->resource('staff');
        $this->assertSame(400, $this->req($this->admin, "/api/clubs/{$this->clubId}/resources/$id/events")['status']);
        $this->assertSame(400, $this->req($this->admin, $this->url($id, 'from=2026-07-01'))['status']);
        $this->assertSame(400, $this->req($this->admin, $this->url($id, 'from=2026-07-31&to=2026-07-01'))['status']);
        $r = $this->req($this->admin, $this->url($id, 'from=2020-01-01&to=2026-01-01'));
        $this->assertSame(400, $r['status']);
        $this->assertSame('to', $r['body']['field'] ?? 'to');
        $this->assertSame(200, $this->req($this->admin, $this->url($id, 'from=2026-01-01&to=2030-12-30'))['status']);
    }

    public function testComposesCalendarsIncludingArchivedAndPaginates(): void
    {
        $id = $this->resource('staff');
        $archived = TestHelper::createCalendar(self::$em, self::$em->getRepository(Club::class)->find($this->clubId), 'Old');
        $archived->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
        $this->event('A', '2026-07-02', false);
        $this->event('B', '2026-07-03', false, $archived->getId());
        $this->event('C', '2026-07-04', false);

        $r = $this->req($this->admin, $this->url($id));
        $this->assertSame(['A', 'B', 'C'], array_column($r['body'], 'name'));
        $this->assertSame(['Main', 'Old', 'Main'], array_column($r['body'], 'calendarName'));

        $r = $this->req($this->admin, $this->url($id, 'from=2026-07-01&to=2026-07-31&limit=1&offset=1'));
        $this->assertSame(['B'], array_column($r['body'], 'name'));
        $this->assertSame('3', self::$client->getResponse()->headers->get('X-Total-Count'));
    }

    public function testOtherClubIsNotFoundAndStrangerForbidden(): void
    {
        $id = $this->resource('members');
        $otherAdmin = TestHelper::createUser(self::$em, self::$hasher, 'other@example.com');
        $otherClub = TestHelper::createClub(self::$em, $otherAdmin, 'Other');

        $r = $this->req($otherAdmin, "/api/clubs/{$otherClub->getId()}/resources/$id/events?from=2026-07-01&to=2026-07-31");
        $this->assertSame(404, $r['status']);
        $this->assertSame(403, $this->req($otherAdmin, $this->url($id))['status']);
    }

    public function testQueryCountIndependentOfEventCount(): void
    {
        $id = $this->resource('staff');
        $this->event('E0', '2026-07-01', false);
        $this->req($this->admin, $this->url($id));
        $count = fn () => $this->queries($id);
        $few = $count();
        for ($i = 1; $i <= 8; ++$i) {
            $this->event("E$i", '2026-07-0'.($i + 1), false);
        }
        $this->assertSame($few, $count());
    }

    private function queries(string $id): int
    {
        $before = QueryCounter::$count;
        $this->req($this->admin, $this->url($id));

        return QueryCounter::$count - $before;
    }
}
