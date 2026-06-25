<?php
declare(strict_types=1);

namespace App\Tests\Controller;

use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use DateMalformedStringException;
use DateTimeImmutable;
use Doctrine\DBAL\Exception as DBALException;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class ResourcesTest extends WebTestCase
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

    /**
     * @throws DBALException
     */
    protected function setUp(): void
    {
        DatabaseResetter::reset(self::$em);
    }

    // --- Properties ---

    public function testPropertyCrud(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/calendars/{$cal->getId()}/properties";

        $list = TestHelper::jsonRequest(self::$client, 'GET', $base, [], $auth);
        $this->assertSame([], $list['body']);

        $create = TestHelper::jsonRequest(self::$client, 'POST', $base, ['name' => 'Indoor', 'icon' => '🏠'], $auth);
        $this->assertSame(201, $create['status']);
        $id = $create['body']['id'];

        $update = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/$id", ['name' => 'Outdoor'], $auth);
        $this->assertSame(200, $update['status']);
        $this->assertSame('Outdoor', $update['body']['name']);

        $delete = TestHelper::jsonRequest(self::$client, 'DELETE', "$base/$id", [], $auth);
        $this->assertSame(200, $delete['status']);
    }

    // --- Templates ---

    public function testTemplateCrud(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/calendars/{$cal->getId()}/templates";

        $create = TestHelper::jsonRequest(self::$client, 'POST', $base, [
            'name' => 'Weekly Training', 'timezone' => 'Europe/Berlin', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
        ], $auth);
        $this->assertSame(201, $create['status']);
        $id = $create['body']['id'];
        $this->assertSame('Weekly Training', $create['body']['name']);

        $get = TestHelper::jsonRequest(self::$client, 'GET', "$base/$id", [], $auth);
        $this->assertSame(200, $get['status']);
        $this->assertSame($id, $get['body']['id']);

        $delete = TestHelper::jsonRequest(self::$client, 'DELETE', "$base/$id", [], $auth);
        $this->assertSame(200, $delete['status']);
    }

    // --- Archived calendar guard ---

    /**
     * @throws DateMalformedStringException
     */
    public function testArchivedCalendarBlocksWrites(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $cal->setArchivedAt(new DateTimeImmutable());
        self::$em->flush();

        $auth = TestHelper::authHeader($user, self::$tokens);
        $r    = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/events", [
            'name' => 'Blocked', 'date' => '2026-07-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00',
        ], $auth);
        $this->assertSame(403, $r['status']);
    }

    public function testArchivedCalendarAllowsReads(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $cal->setArchivedAt(new DateTimeImmutable());
        self::$em->flush();

        $auth = TestHelper::authHeader($user, self::$tokens);
        $r    = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/events", [], $auth);
        $this->assertSame(200, $r['status']);
    }
}
