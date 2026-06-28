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

class HolidayCalendarTest extends WebTestCase
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

    public function testListReturnsEmptyArray(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/holiday-calendars", [], $auth);

        $this->assertSame(200, $r['status']);
        $this->assertSame([], $r['body']);
    }

    public function testCreateValidationRejectsEmptyName(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars", [
            'name' => '', 'url' => 'https://example.com/holidays.ics',
        ], $auth);

        $this->assertSame(422, $r['status']);
    }

    public function testCreateValidationRejectsInvalidUrl(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars", [
            'name' => 'Holidays', 'url' => 'not-a-url',
        ], $auth);

        $this->assertSame(422, $r['status']);
    }

    public function testDeleteReturns404ForNonExistentId(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'DELETE', "/api/calendars/{$cal->getId()}/holiday-calendars/99999", [], $auth);

        $this->assertSame(404, $r['status']);
    }

    public function testListHolidayEventsRequiresFromAndTo(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/holiday-events", [], $auth);

        $this->assertSame(400, $r['status']);
    }

    public function testListHolidayEventsReturnsEmptyArray(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/holiday-events?from=2026-01-01&to=2026-12-31", [], $auth);

        $this->assertSame(200, $r['status']);
        $this->assertSame([], $r['body']);
    }

    public function testRefreshReturns404ForNonExistentId(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars/99999/refresh", [], $auth);

        $this->assertSame(404, $r['status']);
    }
}
