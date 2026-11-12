<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\ClubInvitation;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Club roles (viewer < editor < admin): permission matrix, role changes, last-admin guards, invitation roles. */
class ClubRolesTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private Club $club;
    private Calendar $calendar;
    /** @var array<string, User> */
    private array $users = [];

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
        $this->users['admin'] = TestHelper::createUser(self::$em, self::$hasher, 'admin@example.com');
        $this->club = TestHelper::createClub(self::$em, $this->users['admin']);
        $this->calendar = TestHelper::createCalendar(self::$em, $this->club);
        foreach (['editor' => ClubRole::EDITOR, 'viewer' => ClubRole::VIEWER] as $name => $role) {
            $this->users[$name] = TestHelper::createUser(self::$em, self::$hasher, "$name@example.com");
            TestHelper::addMember(self::$em, $this->club, $this->users[$name], $role);
        }
        $this->users['stranger'] = TestHelper::createUser(self::$em, self::$hasher, 'stranger@example.com');
    }

    /** @return array{status: int, body: mixed, content: string, headers: array<string, list<string>>} */
    private function req(string $who, string $method, string $uri, array $body = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $body, TestHelper::authHeader($this->users[$who], self::$tokens));
    }

    private function cid(): string
    {
        return $this->club->getId();
    }

    private function calId(): string
    {
        return $this->calendar->getId();
    }

    private function role(string $who): ClubRole
    {
        self::$em->clear();

        return self::$em->getRepository(ClubUser::class)->findOneBy(['club' => $this->cid(), 'user' => $this->users[$who]->getId()])->getRole();
    }

    /**
     * @return iterable<string, array{string, string, array<string, bool>}>
     */
    public static function matrix(): iterable
    {
        // method, uri (placeholders {club}, {cal}), allowed per role, body
        yield 'read club' => ['GET', '/api/clubs/{club}', ['viewer' => true, 'editor' => true, 'admin' => true]];
        yield 'read events' => ['GET', '/api/calendars/{cal}/events', ['viewer' => true, 'editor' => true, 'admin' => true]];
        yield 'read ics' => ['GET', '/api/calendars/{cal}/events.ics', ['viewer' => true, 'editor' => true, 'admin' => true]];
        yield 'read members' => ['GET', '/api/clubs/{club}/members', ['viewer' => true, 'editor' => true, 'admin' => true]];
        yield 'read locations' => ['GET', '/api/clubs/{club}/locations', ['viewer' => true, 'editor' => true, 'admin' => true]];
        yield 'read feeds' => ['GET', '/api/clubs/{club}/feeds?includeSecret=1', ['viewer' => false, 'editor' => true, 'admin' => true]];
        yield 'write event' => ['POST', '/api/calendars/{cal}/events', ['viewer' => false, 'editor' => true, 'admin' => true]];
        yield 'write location' => ['POST', '/api/clubs/{club}/locations', ['viewer' => false, 'editor' => true, 'admin' => true]];
        yield 'write property' => ['POST', '/api/calendars/{cal}/properties', ['viewer' => false, 'editor' => true, 'admin' => true]];
        yield 'read properties' => ['GET', '/api/calendars/{cal}/properties', ['viewer' => true, 'editor' => true, 'admin' => true]];
        yield 'read features' => ['GET', '/api/calendars/{cal}/features', ['viewer' => true, 'editor' => true, 'admin' => true]];
        yield 'write feature' => ['POST', '/api/calendars/{cal}/features', ['viewer' => false, 'editor' => true, 'admin' => true]];
        yield 'read target groups' => ['GET', '/api/clubs/{club}/target-groups', ['viewer' => true, 'editor' => true, 'admin' => true]];
        yield 'write target group' => ['POST', '/api/clubs/{club}/target-groups', ['viewer' => false, 'editor' => true, 'admin' => true]];
        yield 'bulk' => ['POST', '/api/calendars/{cal}/events/bulk', ['viewer' => false, 'editor' => true, 'admin' => true]];
        yield 'import' => ['POST', '/api/calendars/{cal}/events/import', ['viewer' => false, 'editor' => true, 'admin' => true]];
        yield 'series preview' => ['POST', '/api/calendars/{cal}/events/series/preview', ['viewer' => false, 'editor' => true, 'admin' => true]];
        yield 'write feed' => ['POST', '/api/clubs/{club}/feeds', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'read one feed' => ['GET', '/api/clubs/{club}/feeds/{feed}', ['viewer' => false, 'editor' => true, 'admin' => true]];
        yield 'change feed' => ['PATCH', '/api/clubs/{club}/feeds/{feed}', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'regenerate feed secret' => ['POST', '/api/clubs/{club}/feeds/{feed}/regenerate-secret', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'delete feed' => ['DELETE', '/api/clubs/{club}/feeds/{feed}', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'create calendar' => ['POST', '/api/clubs/{club}/calendars', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'archive calendar' => ['POST', '/api/clubs/{club}/calendars/{cal}/archive', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'rename club' => ['PATCH', '/api/clubs/{club}', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'list invitations' => ['GET', '/api/clubs/{club}/invitations', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'invite' => ['POST', '/api/clubs/{club}/invitations', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'change role' => ['PATCH', '/api/clubs/{club}/members/{viewer}', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'remove other' => ['DELETE', '/api/clubs/{club}/members/{stranger}', ['viewer' => false, 'editor' => false, 'admin' => true]];
        yield 'delete club' => ['DELETE', '/api/clubs/{club}', ['viewer' => false, 'editor' => false, 'admin' => true]];
    }

    /**
     * A role is "allowed" when the answer is not 403; the body is empty/invalid on purpose, so an allowed role
     * ends in some 2xx/4xx other than 403 (the permission check runs first).
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('matrix')]
    public function testPermissionMatrix(string $method, string $uri, array $allowed): void
    {
        $uri = strtr($uri, [
            '{club}' => $this->cid(),
            '{cal}' => $this->calId(),
            '{feed}' => TestHelper::createFeed(self::$em, $this->club, [$this->calendar])->getId(),
            '{viewer}' => $this->users['viewer']->getId(),
            '{stranger}' => $this->users['stranger']->getId(),
        ]);
        // The admin goes last: some of the routes remove the club or the member
        $this->assertSame(403, $this->req('stranger', $method, $uri)['status'], "stranger $method $uri");
        foreach (['viewer', 'editor', 'admin'] as $who) {
            $r = $this->req($who, $method, $uri);
            if ($allowed[$who]) {
                $this->assertNotSame(403, $r['status'], "$who $method $uri: ".$r['content']);
            } else {
                $this->assertSame(403, $r['status'], "$who $method $uri: ".$r['content']);
            }
        }
    }

    public function testClubListAndDetailShowTheOwnRole(): void
    {
        foreach (['viewer', 'editor', 'admin'] as $who) {
            $list = $this->req($who, 'GET', '/api/clubs');
            $this->assertSame($who, $list['body'][0]['role']);
            $this->assertSame($who, $this->req($who, 'GET', '/api/clubs/'.$this->cid())['body']['role']);
        }
        $created = $this->req('stranger', 'POST', '/api/clubs', ['name' => 'Mine']);
        $this->assertSame('admin', $created['body']['role']);
    }

    public function testMembersListShowsRoles(): void
    {
        $r = $this->req('viewer', 'GET', "/api/clubs/{$this->cid()}/members");
        $roles = array_column($r['body'], 'role', 'email');
        $this->assertSame(['admin@example.com' => 'admin', 'editor@example.com' => 'editor', 'viewer@example.com' => 'viewer'], $roles);
    }

    public function testAdminChangesARole(): void
    {
        $r = $this->req('admin', 'PATCH', "/api/clubs/{$this->cid()}/members/{$this->users['viewer']->getId()}", ['role' => 'editor']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame('editor', $r['body']['role']);
        $this->assertSame(ClubRole::EDITOR, $this->role('viewer'));
        // The new right applies immediately
        $this->assertSame(201, $this->req('viewer', 'POST', "/api/clubs/{$this->cid()}/locations", ['name' => 'Hall'])['status']);
    }

    public function testInvalidRoleAndUnknownMember(): void
    {
        $uri = "/api/clubs/{$this->cid()}/members/{$this->users['viewer']->getId()}";
        foreach ([['x' => 1], ['role' => 'owner'], ['role' => 5], ['role' => null]] as $body) {
            $r = $this->req('admin', 'PATCH', $uri, $body);
            $this->assertSame(422, $r['status'], $r['content']);
            $this->assertSame('invalid_role', $r['body']['code']);
            $this->assertSame('role', $r['body']['field']);
        }
        $r = $this->req('admin', 'PATCH', "/api/clubs/{$this->cid()}/members/{$this->users['stranger']->getId()}", ['role' => 'viewer']);
        $this->assertSame(404, $r['status']);
        $this->assertSame('member_not_found', $r['body']['code']);
    }

    public function testLastAdminCannotBeDemotedRemovedOrLeave(): void
    {
        $admin = $this->users['admin']->getId();
        $r = $this->req('admin', 'PATCH', "/api/clubs/{$this->cid()}/members/$admin", ['role' => 'editor']);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('last_admin', $r['body']['code']);

        $r = $this->req('admin', 'DELETE', "/api/clubs/{$this->cid()}/members/$admin");
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('last_admin', $r['body']['code']);
        $this->assertSame(ClubRole::ADMIN, $this->role('admin'));
    }

    public function testASecondAdminLetsTheFirstStepDownOrLeave(): void
    {
        $this->assertSame(200, $this->req('admin', 'PATCH', "/api/clubs/{$this->cid()}/members/{$this->users['editor']->getId()}", ['role' => 'admin'])['status']);
        $this->assertSame(200, $this->req('admin', 'PATCH', "/api/clubs/{$this->cid()}/members/{$this->users['admin']->getId()}", ['role' => 'viewer'])['status']);
        $this->assertSame(ClubRole::VIEWER, $this->role('admin'));
        // The former admin has lost the right at once; the new admin is the last one now
        $this->assertSame(403, $this->req('admin', 'PATCH', "/api/clubs/{$this->cid()}", ['name' => 'X'])['status']);
        $r = $this->req('editor', 'DELETE', "/api/clubs/{$this->cid()}/members/{$this->users['editor']->getId()}");
        $this->assertSame('last_admin', $r['body']['code']);
    }

    public function testNonAdminsMayLeaveButNotRemoveOthers(): void
    {
        $r = $this->req('editor', 'DELETE', "/api/clubs/{$this->cid()}/members/{$this->users['viewer']->getId()}");
        $this->assertSame(403, $r['status']);
        $this->assertSame(200, $this->req('viewer', 'DELETE', "/api/clubs/{$this->cid()}/members/{$this->users['viewer']->getId()}")['status']);
        $this->assertSame(200, $this->req('editor', 'DELETE', "/api/clubs/{$this->cid()}/members/{$this->users['editor']->getId()}")['status']);
        $this->assertSame(403, $this->req('editor', 'GET', '/api/clubs/'.$this->cid())['status']);
    }

    public function testRemovingAnotherAdminIsAllowedWhileOneRemains(): void
    {
        $this->assertSame(200, $this->req('admin', 'PATCH', "/api/clubs/{$this->cid()}/members/{$this->users['editor']->getId()}", ['role' => 'admin'])['status']);
        $this->assertSame(200, $this->req('admin', 'DELETE', "/api/clubs/{$this->cid()}/members/{$this->users['editor']->getId()}")['status']);
    }

    public function testAccountDeletionOfTheLastAdminIsRefusedWhileOthersRemain(): void
    {
        $r = TestHelper::deleteAccount(self::$client, $this->users['admin'], self::$tokens);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('last_admin_of_club', $r['body']['code']);

        // A non-admin may delete the account; with a second admin the first may as well
        $this->assertSame(200, TestHelper::deleteAccount(self::$client, $this->users['viewer'], self::$tokens)['status']);
        $this->assertSame(200, $this->req('admin', 'PATCH', "/api/clubs/{$this->cid()}/members/{$this->users['editor']->getId()}", ['role' => 'admin'])['status']);
        $this->assertSame(200, TestHelper::deleteAccount(self::$client, $this->users['admin'], self::$tokens)['status']);
    }

    public function testInvitationCarriesTheRoleToTheMembership(): void
    {
        foreach ([null, 'viewer', 'admin'] as $i => $role) {
            $email = "invitee$i@example.com";
            $body = ['email' => $email] + (null === $role ? [] : ['role' => $role]);
            $this->assertSame(204, $this->req('admin', 'POST', "/api/clubs/{$this->cid()}/invitations", $body)['status']);
            $this->users[$email] = TestHelper::createUser(self::$em, self::$hasher, $email);
            $list = $this->req($email, 'GET', '/api/invitations');
            $this->assertSame($role ?? 'editor', $list['body'][0]['role']);
            $this->assertSame(200, $this->req($email, 'POST', "/api/invitations/{$list['body'][0]['id']}/accept")['status']);
            $this->assertSame(ClubRole::from($role ?? 'editor'), $this->role($email));
        }
    }

    public function testInvitingAgainChangesTheRoleOfAnOpenInvitation(): void
    {
        $uri = "/api/clubs/{$this->cid()}/invitations";
        $this->assertSame(204, $this->req('admin', 'POST', $uri, ['email' => 'x@example.com', 'role' => 'viewer'])['status']);
        $this->assertSame(204, $this->req('admin', 'POST', $uri, ['email' => 'x@example.com', 'role' => 'admin'])['status']);
        $list = $this->req('admin', 'GET', $uri);
        $this->assertCount(1, $list['body']);
        $this->assertSame('admin', $list['body'][0]['role']);
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(ClubInvitation::class)->count([]));
    }

    public function testInvitationRoleMustBeKnown(): void
    {
        $r = $this->req('admin', 'POST', "/api/clubs/{$this->cid()}/invitations", ['email' => 'y@example.com', 'role' => 'owner']);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('validation_failed', $r['body']['code']);
    }
}
