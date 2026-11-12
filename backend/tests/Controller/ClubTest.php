<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\ClubUser;
use App\Entity\User;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class ClubTest extends WebTestCase
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

    public function testListReturns401WithoutAuth(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs');
        $this->assertSame(401, $r['status']);
    }

    public function testListReturnsUserClubs(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        TestHelper::createClub(self::$em, $user, 'My Club');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $auth);
        $this->assertSame(200, $r['status']);
        $names = array_column($r['body'], 'name');
        $this->assertContains('My Club', $names);
    }

    public function testCreateClubReturns201(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/clubs', [
            'name' => 'New Club', 'timezone' => 'Europe/London',
        ], $auth);
        $this->assertSame(201, $r['status']);
        $this->assertSame('New Club', $r['body']['name']);
    }

    public function testGetClubReturns403ForNonMember(): void
    {
        $owner = TestHelper::createUser(self::$em, self::$hasher, 'owner@example.com');
        $other = TestHelper::createUser(self::$em, self::$hasher, 'other@example.com');
        $club = TestHelper::createClub(self::$em, $owner);
        $auth = TestHelper::authHeader($other, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/clubs/{$club->getId()}", [], $auth);
        $this->assertSame(403, $r['status']);
    }

    public function testGetClubReturnsMember(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $club = TestHelper::createClub(self::$em, $user, 'My Club');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/clubs/{$club->getId()}", [], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertSame($club->getId(), $r['body']['id']);
    }

    public function testDeleteClub(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $club = TestHelper::createClub(self::$em, $user);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'DELETE', "/api/clubs/{$club->getId()}", [], $auth);
        $this->assertSame(200, $r['status']);
    }

    // --- L1: a club never has zero members ---

    public function testTheLastMemberCannotLeaveOrBeRemoved(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $club = TestHelper::createClub(self::$em, $user);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'DELETE', "/api/clubs/{$club->getId()}/members/{$user->getId()}", [], $auth);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('last_member', $r['body']['code']);
        $this->assertSame(1, self::$em->getRepository(ClubUser::class)->count(['club' => $club]));
    }

    public function testTheSecondToLastMemberCanLeaveButThenTheOtherIsTheLast(): void
    {
        $a = TestHelper::createUser(self::$em, self::$hasher, 'a@example.com');
        $b = TestHelper::createUser(self::$em, self::$hasher, 'b@example.com');
        $club = TestHelper::createClub(self::$em, $a);
        self::$em->persist((new ClubUser())->setClub($club)->setUser($b));
        self::$em->flush();
        $url = "/api/clubs/{$club->getId()}/members";

        $left = TestHelper::jsonRequest(self::$client, 'DELETE', "$url/{$a->getId()}", [], TestHelper::authHeader($a, self::$tokens));
        $this->assertSame(200, $left['status'], $left['content']);
        $last = TestHelper::jsonRequest(self::$client, 'DELETE', "$url/{$b->getId()}", [], TestHelper::authHeader($b, self::$tokens));
        $this->assertSame(422, $last['status'], $last['content']);
        $this->assertSame('last_member', $last['body']['code']);
    }

    public function testDeletingTheAccountOfTheOnlyMemberOfAClubIsRefused(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'solo@example.com');
        $club = TestHelper::createClub(self::$em, $user);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::deleteAccount(self::$client, $user, self::$tokens);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('last_member_of_club', $r['body']['code']);
        $this->assertStringNotContainsString($club->getName(), $r['content']);
        self::$em->clear();
        $this->assertNotNull(self::$em->getRepository(User::class)->findOneBy(['email' => 'solo@example.com']));

        // Deleting the club first makes the account deletion possible
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'DELETE', "/api/clubs/{$club->getId()}", [], $auth)['status']);
        $this->assertSame(200, TestHelper::deleteAccount(self::$client, $user, self::$tokens)['status']);
        self::$em->clear();
        $this->assertNull(self::$em->getRepository(User::class)->findOneBy(['email' => 'solo@example.com']));
    }

    public function testAccountDeletionIsAllowedWhenEveryClubHasOtherMembers(): void
    {
        $a = TestHelper::createUser(self::$em, self::$hasher, 'a@example.com');
        $b = TestHelper::createUser(self::$em, self::$hasher, 'b@example.com');
        $club = TestHelper::createClub(self::$em, $a);
        self::$em->persist((new ClubUser())->setClub($club)->setUser($b));
        self::$em->flush();
        $r = TestHelper::deleteAccount(self::$client, $a, self::$tokens);
        $this->assertSame(200, $r['status'], $r['content']);
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(ClubUser::class)->count([]));
    }
}
