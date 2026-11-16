<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Club;
use App\Entity\Resource;
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

class ResourceTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $admin;
    private Club $club;
    private string $base;

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
        $this->base = '/api/clubs/'.$this->club->getId().'/resources';
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive across tests (see AuthTest).
    }

    private function req(User $who, string $method, string $uri, array $body = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $body, TestHelper::authHeader($who, self::$tokens));
    }

    private function location(string $name = 'Test Location'): \App\Entity\Location
    {
        // The kernel clears the entity manager between requests: re-fetch the club
        $club = self::$em->getRepository(Club::class)->find($this->club->getId());

        return TestHelper::createLocation(self::$em, $club, $name);
    }

    private function userWithRole(ClubRole $role): User
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, $role->value.'@example.com');
        TestHelper::addMember(self::$em, self::$em->getRepository(Club::class)->find($this->club->getId()), $user, $role);

        return $user;
    }

    private function create(string $name = 'Hall', ?string $locationId = null, array $extra = []): array
    {
        $locationId ??= $this->location($name)->getId();

        return $this->req($this->admin, 'POST', $this->base, ['name' => $name, 'locationId' => $locationId] + $extra);
    }

    public function testAdminCreatesWithDefaults(): void
    {
        $location = $this->location();
        $r = $this->req($this->admin, 'POST', $this->base, ['name' => ' Hall ', 'locationId' => $location->getId()]);

        $this->assertSame(201, $r['status']);
        $this->assertSame('Hall', $r['body']['name']);
        $this->assertSame('location', $r['body']['type']);
        $this->assertSame('staff', $r['body']['visibility']);
        $this->assertFalse($r['body']['allowDoubleBooking']);
        $this->assertSame(0, $r['body']['bufferMinutes']);
        $this->assertSame($location->getId(), $r['body']['locationId']);
        $this->assertSame($this->club->getId(), $r['body']['clubId']);
    }

    public function testCreateWithAllFieldsListUpdateDelete(): void
    {
        $r = $this->create('Hall', null, ['visibility' => 'members', 'allowDoubleBooking' => true, 'bufferMinutes' => 90]);
        $this->assertSame(201, $r['status']);
        $id = $r['body']['id'];
        $this->assertSame('members', $r['body']['visibility']);
        $this->assertTrue($r['body']['allowDoubleBooking']);
        $this->assertSame(90, $r['body']['bufferMinutes']);

        $list = $this->req($this->admin, 'GET', $this->base);
        $this->assertSame(200, $list['status']);
        $this->assertCount(1, $list['body']);

        $r = $this->req($this->admin, 'PATCH', "{$this->base}/$id", ['name' => 'Big Hall', 'visibility' => 'staff', 'allowDoubleBooking' => false, 'bufferMinutes' => 1440]);
        $this->assertSame(200, $r['status']);
        $this->assertSame('Big Hall', $r['body']['name']);
        $this->assertSame('staff', $r['body']['visibility']);
        $this->assertFalse($r['body']['allowDoubleBooking']);
        $this->assertSame(1440, $r['body']['bufferMinutes']);

        $this->assertSame(200, $this->req($this->admin, 'DELETE', "{$this->base}/$id")['status']);
        $this->assertSame([], $this->req($this->admin, 'GET', $this->base)['body']);
        $this->assertSame(404, $this->req($this->admin, 'DELETE', "{$this->base}/$id")['status']);
    }

    public function testPermissionsPerRole(): void
    {
        $id = $this->create()['body']['id'];
        $locationId = $this->location('Other')->getId();

        foreach ([ClubRole::VIEWER, ClubRole::EDITOR] as $role) {
            $user = $this->userWithRole($role);
            $this->assertSame(200, $this->req($user, 'GET', $this->base)['status'], $role->value);
            $this->assertSame(403, $this->req($user, 'POST', $this->base, ['name' => 'x', 'locationId' => $locationId])['status'], $role->value);
            $this->assertSame(403, $this->req($user, 'PATCH', "{$this->base}/$id", ['name' => 'x'])['status'], $role->value);
            $this->assertSame(403, $this->req($user, 'DELETE', "{$this->base}/$id")['status'], $role->value);
        }

        $member = $this->userWithRole(ClubRole::MEMBER);
        // plain members may list, but only `members` resources (see ResourceCalendarTest)
        $this->assertSame([], $this->req($member, 'GET', $this->base)['body']);

        $stranger = TestHelper::createUser(self::$em, self::$hasher, 'stranger@example.com');
        $this->assertSame(403, $this->req($stranger, 'GET', $this->base)['status']);
        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'GET', $this->base)['status']);
    }

    public function testLocationOfAnotherClubIsRejected(): void
    {
        $otherOwner = TestHelper::createUser(self::$em, self::$hasher, 'other@example.com');
        $otherClub = TestHelper::createClub(self::$em, $otherOwner, 'Other Club');
        $foreign = TestHelper::createLocation(self::$em, $otherClub);

        $r = $this->req($this->admin, 'POST', $this->base, ['name' => 'x', 'locationId' => $foreign->getId()]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('unknown_reference', $r['body']['code']);
        $this->assertSame('locationId', $r['body']['field']);

        $r = $this->req($this->admin, 'POST', $this->base, ['name' => 'x', 'locationId' => '00000000-0000-7000-8000-000000000000']);
        $this->assertSame('unknown_reference', $r['body']['code']);
    }

    public function testResourcesOfAnotherClubAreNotReachable(): void
    {
        $id = $this->create()['body']['id'];
        $otherOwner = TestHelper::createUser(self::$em, self::$hasher, 'other@example.com');
        $otherClub = TestHelper::createClub(self::$em, $otherOwner, 'Other Club');
        $other = '/api/clubs/'.$otherClub->getId().'/resources';

        $this->assertSame([], $this->req($otherOwner, 'GET', $other)['body']);
        $this->assertSame(404, $this->req($otherOwner, 'PATCH', "$other/$id", ['name' => 'x'])['status']);
        $this->assertSame(404, $this->req($otherOwner, 'DELETE', "$other/$id")['status']);
    }

    public function testLocationCanBeResourceOnlyOnce(): void
    {
        $locationId = $this->location()->getId();
        $this->assertSame(201, $this->create('A', $locationId)['status']);

        $r = $this->create('B', $locationId);
        $this->assertSame(422, $r['status']);
        $this->assertSame('duplicate_resource', $r['body']['code']);
        $this->assertSame('locationId', $r['body']['field']);
    }

    /** @return array<string, array{0: array<string, mixed>, 1: string}> */
    public static function invalidBodies(): array
    {
        return [
            'no name' => [['name' => null], 'name'],
            'blank name' => [['name' => '  '], 'name'],
            'long name' => [['name' => str_repeat('a', 256)], 'name'],
            'no location' => [['locationId' => null], 'locationId'],
            'bad type' => [['type' => 'room'], 'type'],
            'bad visibility' => [['visibility' => 'public'], 'visibility'],
            'double booking string' => [['allowDoubleBooking' => 'yes'], 'allowDoubleBooking'],
            'buffer negative' => [['bufferMinutes' => -1], 'bufferMinutes'],
            'buffer too large' => [['bufferMinutes' => 1441], 'bufferMinutes'],
            'buffer string' => [['bufferMinutes' => '30'], 'bufferMinutes'],
            'buffer float' => [['bufferMinutes' => 1.5], 'bufferMinutes'],
        ];
    }

    /**
     * @param array<string, mixed> $body
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('invalidBodies')]
    public function testCreateValidation(array $body, string $field): void
    {
        $body += ['name' => 'x', 'locationId' => $this->location()->getId()];
        $r = $this->req($this->admin, 'POST', $this->base, $body);
        $this->assertSame(400, $r['status']);
        $this->assertSame('validation_failed', $r['body']['code']);
        $this->assertSame($field, $r['body']['field']);
        $this->assertSame(0, self::$em->getRepository(Resource::class)->count([]));
    }

    public function testBufferBoundsAreAccepted(): void
    {
        $id = $this->create('A', null, ['bufferMinutes' => 0])['body']['id'];
        $r = $this->req($this->admin, 'PATCH', "{$this->base}/$id", ['bufferMinutes' => 1440]);
        $this->assertSame(200, $r['status']);
        $r = $this->req($this->admin, 'PATCH', "{$this->base}/$id", ['bufferMinutes' => 1441]);
        $this->assertSame(400, $r['status']);
        $this->assertSame(1440, self::$em->getRepository(Resource::class)->find($id)->getBufferMinutes());
    }

    public function testUpdateValidationAndImmutableLocation(): void
    {
        $created = $this->create()['body'];
        $other = $this->location('Other');
        $r = $this->req($this->admin, 'PATCH', "{$this->base}/{$created['id']}", ['visibility' => 'nope']);
        $this->assertSame(400, $r['status']);
        $this->assertSame('visibility', $r['body']['field']);

        $r = $this->req($this->admin, 'PATCH', "{$this->base}/{$created['id']}", ['locationId' => $other->getId(), 'name' => 'Renamed']);
        $this->assertSame(200, $r['status']);
        $this->assertSame($created['locationId'], $r['body']['locationId']);
    }

    public function testDeletingTheLocationRemovesTheResource(): void
    {
        $created = $this->create()['body'];
        $r = $this->req($this->admin, 'DELETE', "/api/clubs/{$this->club->getId()}/locations/{$created['locationId']}");
        $this->assertSame(200, $r['status']);
        $this->assertSame([], $this->req($this->admin, 'GET', $this->base)['body']);
    }

    public function testDeletingTheResourceKeepsTheLocation(): void
    {
        $created = $this->create()['body'];
        $this->req($this->admin, 'DELETE', "{$this->base}/{$created['id']}");
        $locations = $this->req($this->admin, 'GET', "/api/clubs/{$this->club->getId()}/locations");
        $this->assertCount(1, $locations['body']);
    }

    public function testQuota(): void
    {
        $limit = Quota::LIMITS[Quota::RESOURCES_PER_CLUB];
        $conn = self::$em->getConnection();
        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        $clubId = $this->club->getId();
        for ($i = 0; $i < $limit; ++$i) {
            $locId = sprintf('00000000-0000-7000-8000-%012d', $i);
            $conn->insert('location', ['id' => $locId, 'club_id' => $clubId, 'updated_at' => $now]);
            $conn->insert('resource', ['id' => sprintf('00000000-0000-7001-8000-%012d', $i), 'club_id' => $clubId, 'location_id' => $locId, 'type' => 'location', 'name' => "R$i", 'visibility' => 'staff', 'allow_double_booking' => 0, 'buffer_minutes' => 0, 'updated_at' => $now]);
        }

        $r = $this->create('One too many');
        $this->assertSame(422, $r['status']);
        $this->assertSame('quota_exceeded', $r['body']['code']);
        $this->assertSame('resourcesPerClub', $r['body']['resource']);
        $this->assertSame($limit, $r['body']['limit']);
    }

    public function testAuditStampIsSet(): void
    {
        $id = $this->create()['body']['id'];
        self::$em->clear();
        $resource = self::$em->getRepository(Resource::class)->find($id);
        $this->assertSame($this->admin->getId(), $resource->getUpdatedBy()?->getId());
    }
}
