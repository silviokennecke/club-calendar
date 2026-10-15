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

/**
 * Audit API-02: PATCH of an archived calendar is denied; DELETE, duplicate, archive and unarchive stay allowed.
 */
class ArchivedCalendarUpdateTest extends WebTestCase
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

    /** @return array{0: string, 1: string} base path and auth header, calendar archived via the API */
    private function archivedCalendar(): array
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/clubs/{$club->getId()}/calendars/{$cal->getId()}";
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'POST', "$base/archive", [], $auth)['status']);

        return [$base, $auth];
    }

    public function testPatchArchivedCalendarIsForbidden(): void
    {
        [$base, $auth] = $this->archivedCalendar();

        $res = TestHelper::jsonRequest(self::$client, 'PATCH', $base, ['name' => 'Renamed'], $auth);
        $this->assertSame(403, $res['status']);

        $this->assertNotSame('Renamed', TestHelper::jsonRequest(self::$client, 'GET', $base, [], $auth)['body']['name']);
    }

    public function testPatchWorksAfterUnarchive(): void
    {
        [$base, $auth] = $this->archivedCalendar();

        $unarchive = TestHelper::jsonRequest(self::$client, 'POST', "$base/unarchive", [], $auth);
        $this->assertSame(200, $unarchive['status']);
        $this->assertNull($unarchive['body']['archivedAt']);

        $res = TestHelper::jsonRequest(self::$client, 'PATCH', $base, ['name' => 'Renamed'], $auth);
        $this->assertSame(200, $res['status']);
        $this->assertSame('Renamed', $res['body']['name']);
    }

    public function testDuplicateArchivedCalendarStillWorks(): void
    {
        [$base, $auth] = $this->archivedCalendar();

        $this->assertSame(201, TestHelper::jsonRequest(self::$client, 'POST', "$base/duplicate", [], $auth)['status']);
    }

    public function testDeleteArchivedCalendarStillWorks(): void
    {
        [$base, $auth] = $this->archivedCalendar();

        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'DELETE', $base, [], $auth)['status']);
        $this->assertSame(404, TestHelper::jsonRequest(self::$client, 'GET', $base, [], $auth)['status']);
    }
}
