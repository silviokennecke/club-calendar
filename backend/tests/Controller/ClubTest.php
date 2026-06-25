<?php
declare(strict_types=1);

namespace App\Tests\Controller;

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
        $container    = static::getContainer();
        self::$em     = $container->get(EntityManagerInterface::class);
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
        $r    = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $auth);
        $this->assertSame(200, $r['status']);
        $names = array_column($r['body'], 'name');
        $this->assertContains('My Club', $names);
    }

    public function testCreateClubReturns201(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r    = TestHelper::jsonRequest(self::$client, 'POST', '/api/clubs', [
            'name' => 'New Club', 'timezone' => 'Europe/London',
        ], $auth);
        $this->assertSame(201, $r['status']);
        $this->assertSame('New Club', $r['body']['name']);
    }

    public function testGetClubReturns403ForNonMember(): void
    {
        $owner = TestHelper::createUser(self::$em, self::$hasher, 'owner@example.com');
        $other = TestHelper::createUser(self::$em, self::$hasher, 'other@example.com');
        $club  = TestHelper::createClub(self::$em, $owner);
        $auth  = TestHelper::authHeader($other, self::$tokens);
        $r     = TestHelper::jsonRequest(self::$client, 'GET', "/api/clubs/{$club->getId()}", [], $auth);
        $this->assertSame(403, $r['status']);
    }

    public function testGetClubReturnsMember(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $club = TestHelper::createClub(self::$em, $user, 'My Club');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r    = TestHelper::jsonRequest(self::$client, 'GET', "/api/clubs/{$club->getId()}", [], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertSame($club->getId(), $r['body']['id']);
    }

    public function testDeleteClub(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $club = TestHelper::createClub(self::$em, $user);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r    = TestHelper::jsonRequest(self::$client, 'DELETE', "/api/clubs/{$club->getId()}", [], $auth);
        $this->assertSame(200, $r['status']);
    }
}
