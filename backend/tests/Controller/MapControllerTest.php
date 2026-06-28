<?php
declare(strict_types=1);

namespace App\Tests\Controller;

use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use App\Service\TokenService;

class MapControllerTest extends WebTestCase
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

    public function testLocationSerializeIncludesUpdatedAt(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $create = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/locations", [
            'name' => 'Test Venue', 'latitude' => 48.137, 'longitude' => 11.575,
        ], $auth);
        $this->assertSame(201, $create['status']);
        $this->assertArrayHasKey('updatedAt', $create['body']);
        $this->assertIsInt($create['body']['updatedAt']);
        $this->assertGreaterThan(0, $create['body']['updatedAt']);
    }
}
