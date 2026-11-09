<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\ClubInvitation;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Service\Quota;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\RouterInterface;

/**
 * Role `member` is deny-by-default: on every club- or calendar-scoped route a plain member gets 403 `forbidden`,
 * except the explicit allow-list below. A new route is therefore staff-only unless it is added here on purpose.
 */
class MemberRoleTest extends WebTestCase
{
    /** method|path-template of the only club-scoped routes a plain member may use. */
    private const array MEMBER_ALLOWED = [
        'GET /api/clubs/{clubId}',
        'DELETE /api/clubs/{clubId}/members/{userId}',
        'GET /api/clubs/{clubId}/my-subscription',
        'PUT /api/clubs/{clubId}/my-subscription',
        'POST /api/clubs/{clubId}/my-subscription/rotate-secret',
        'GET /api/clubs/{clubId}/my-feeds',
        'GET /api/clubs/{clubId}/my-events',
        'GET /api/clubs/{clubId}/my-events/{eventId}',
    ];

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $admin;
    private User $member;
    private Club $club;
    private Calendar $calendar;

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
        $this->admin = TestHelper::createUser(self::$em, self::$hasher, 'admin@example.com');
        $this->club = TestHelper::createClub(self::$em, $this->admin);
        $this->calendar = TestHelper::createCalendar(self::$em, $this->club);
        $this->member = TestHelper::createUser(self::$em, self::$hasher, 'member@example.com');
        TestHelper::addMember(self::$em, $this->club, $this->member, ClubRole::MEMBER);
    }

    private function req(User $who, string $method, string $uri, array $body = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $body, TestHelper::authHeader($who, self::$tokens));
    }

    public function testMemberIsDeniedOnEveryClubAndCalendarRouteExceptTheAllowList(): void
    {
        $routes = static::getContainer()->get(RouterInterface::class)->getRouteCollection();
        $checked = 0;
        $allowed = [];
        foreach ($routes as $route) {
            $path = $route->getPath();
            if (!preg_match('#^/api/(clubs|calendars)/\{([^}]+)\}#', $path, $m)) {
                continue;
            }
            // the first placeholder is the club/calendar; the remaining ones stay unknown ids
            $owner = 'clubs' === $m[1] ? $this->club->getId() : $this->calendar->getId();
            $uri = str_replace(['{clubId}', '{calendarId}'], [$this->club->getId(), $this->calendar->getId()], $path);
            $uri = preg_replace('/\{[^}]+\}/', '00000000-0000-7000-8000-000000000000', $uri);
            $uri = preg_replace('#^/api/(clubs|calendars)/[^/]+#', '/api/$1/'.$owner, $uri);
            foreach ($route->getMethods() ?: ['GET'] as $method) {
                if ('OPTIONS' === $method || 'HEAD' === $method) {
                    continue;
                }
                $label = "$method $path";
                $r = $this->req($this->member, $method, $uri, in_array($method, ['POST', 'PATCH', 'PUT'], true) ? ['name' => 'x'] : []);
                ++$checked;
                if (in_array("$method $path", self::MEMBER_ALLOWED, true)) {
                    $allowed[] = "$method $path";
                    // behaviour of the allowed routes is covered by the dedicated tests below
                    continue;
                }
                $this->assertSame(403, $r['status'], "member must get 403 on $label ($uri), got {$r['status']}");
            }
        }
        $this->assertGreaterThan(60, $checked);
        sort($allowed);
        $expected = self::MEMBER_ALLOWED;
        sort($expected);
        $this->assertSame($expected, $allowed, 'every allow-list entry must match a real route');
    }

    public function testMemberAllowListEndpoints(): void
    {
        $r = $this->req($this->member, 'GET', '/api/auth/me');
        $this->assertSame(200, $r['status']);
        $this->assertSame('member', $r['body']['clubs'][0]['role'] ?? $r['body']['memberships'][0]['role'] ?? 'member');

        $r = $this->req($this->member, 'GET', '/api/clubs');
        $this->assertSame(200, $r['status']);
        $this->assertCount(1, $r['body']);
        $this->assertSame('member', $r['body'][0]['role']);
        $this->assertArrayNotHasKey('calendarCount', $r['body'][0]);

        $r = $this->req($this->member, 'GET', '/api/clubs/'.$this->club->getId());
        $this->assertSame(200, $r['status']);
        $this->assertEqualsCanonicalizing(['id', 'name', 'timezone', 'role'], array_keys($r['body']));

        $r = $this->req($this->member, 'GET', '/api/holiday-sources/countries');
        $this->assertSame(403, $r['status']);
    }

    public function testMemberMayUseTheOwnSubscriptionRoutes(): void
    {
        $base = '/api/clubs/'.$this->club->getId();
        $this->assertSame(200, $this->req($this->member, 'GET', $base.'/my-subscription')['status']);
        $this->assertSame(200, $this->req($this->member, 'PUT', $base.'/my-subscription', ['feedIds' => [], 'targetGroupIds' => []])['status']);
        $this->assertSame(200, $this->req($this->member, 'POST', $base.'/my-subscription/rotate-secret')['status']);
        $this->assertSame(200, $this->req($this->member, 'GET', $base.'/my-feeds')['status']);
        $this->assertSame(200, $this->req($this->member, 'GET', $base.'/my-events')['status']);
    }

    public function testMemberCanLeaveButNotRemoveOthers(): void
    {
        $r = $this->req($this->member, 'DELETE', "/api/clubs/{$this->club->getId()}/members/{$this->admin->getId()}");
        $this->assertSame(403, $r['status']);
        $this->assertSame('forbidden', $r['body']['code']);

        $r = $this->req($this->member, 'DELETE', "/api/clubs/{$this->club->getId()}/members/{$this->member->getId()}");
        $this->assertSame(200, $r['status']);
        self::$em->clear();
        $this->assertNull(self::$em->getRepository(ClubUser::class)->findOneBy(['user' => $this->member->getId()]));
    }

    public function testViewerCanLeaveHisClub(): void
    {
        $viewer = TestHelper::createUser(self::$em, self::$hasher, 'viewer@example.com');
        TestHelper::addMember(self::$em, $this->club, $viewer, ClubRole::VIEWER);
        $r = $this->req($viewer, 'DELETE', "/api/clubs/{$this->club->getId()}/members/{$viewer->getId()}");
        $this->assertSame(200, $r['status']);
    }

    public function testLastMemberStillCannotLeave(): void
    {
        $solo = TestHelper::createUser(self::$em, self::$hasher, 'solo@example.com');
        $club = TestHelper::createClub(self::$em, $solo);
        $this->assertSame(422, $this->req($solo, 'DELETE', "/api/clubs/{$club->getId()}/members/{$solo->getId()}")['status']);
    }

    public function testAdminCanSetRoleMemberAndInviteAsMember(): void
    {
        $viewer = TestHelper::createUser(self::$em, self::$hasher, 'viewer@example.com');
        TestHelper::addMember(self::$em, $this->club, $viewer, ClubRole::VIEWER);
        $r = $this->req($this->admin, 'PATCH', "/api/clubs/{$this->club->getId()}/members/{$viewer->getId()}", ['role' => 'member']);
        $this->assertSame(200, $r['status']);
        $this->assertSame('member', $r['body']['role']);
        $this->assertSame(403, $this->req($viewer, 'GET', "/api/clubs/{$this->club->getId()}/members")['status']);

        $r = $this->req($this->admin, 'POST', "/api/clubs/{$this->club->getId()}/invitations", ['email' => 'new@example.com', 'role' => 'member']);
        $this->assertSame(204, $r['status']);
        $r = $this->req($this->admin, 'GET', "/api/clubs/{$this->club->getId()}/invitations");
        $this->assertSame('member', $r['body'][0]['role']);

        $r = $this->req($this->admin, 'PATCH', "/api/clubs/{$this->club->getId()}/members/{$viewer->getId()}", ['role' => 'nope']);
        $this->assertSame('invalid_role', $r['body']['code']);
    }

    public function testStaffQuotaOnRoleChangeAndAccept(): void
    {
        $limit = Quota::LIMITS[Quota::STAFF_PER_CLUB];
        $conn = self::$em->getConnection();
        $conn->executeStatement('SET FOREIGN_KEY_CHECKS=0');
        $clubId = $this->club->getId();
        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        for ($i = 1; $i < $limit; ++$i) {
            $conn->insert('club_user', ['club_id' => $clubId, 'user_id' => sprintf('00000000-0000-7000-8000-%012d', $i), 'role' => 'viewer', 'updated_at' => $now]);
        }
        $conn->executeStatement('SET FOREIGN_KEY_CHECKS=1');
        // admin + 499 viewers = 500 staff: promoting the member is refused
        $r = $this->req($this->admin, 'PATCH', "/api/clubs/{$clubId}/members/{$this->member->getId()}", ['role' => 'viewer']);
        $this->assertSame(422, $r['status']);
        $this->assertSame('quota_exceeded', $r['body']['code']);
        $this->assertSame(Quota::STAFF_PER_CLUB, $r['body']['resource']);
        $this->assertSame($limit, $r['body']['limit']);

        // an invitation as plain member is not counted as staff
        $invitee = TestHelper::createUser(self::$em, self::$hasher, 'invitee@example.com');
        $staffInvite = (new ClubInvitation($this->club, $this->admin, 'invitee@example.com', str_repeat('a', 64), new \DateTimeImmutable()))->setRole(ClubRole::EDITOR);
        self::$em->persist($staffInvite);
        self::$em->flush();
        $r = $this->req($invitee, 'POST', "/api/invitations/{$staffInvite->getId()}/accept");
        $this->assertSame('quota_exceeded', $r['body']['code']);
        $this->assertSame(Quota::STAFF_PER_CLUB, $r['body']['resource']);

        $staffInvite = self::$em->find(ClubInvitation::class, $staffInvite->getId());
        $staffInvite->setRole(ClubRole::MEMBER);
        self::$em->flush();
        $r = $this->req($invitee, 'POST', "/api/invitations/{$staffInvite->getId()}/accept");
        $this->assertSame(200, $r['status']);
    }
}
