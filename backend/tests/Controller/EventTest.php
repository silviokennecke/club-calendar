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

class EventTest extends WebTestCase
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

    public function testListReturnsEmptyArrayInitially(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/events", [], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertSame([], $r['body']);
    }

    public function testCreatesSingleEvent(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/events", [
            'name' => 'Club Night', 'date' => '2026-07-01', 'timeBegin' => '20:00', 'timeEnd' => '23:00', 'isDraft' => false,
        ], $auth);
        $this->assertSame(201, $r['status']);
        $this->assertSame('Club Night', $r['body']['name']);
        $this->assertFalse($r['body']['isDraft']);
    }

    /**
     * @throws \DateMalformedStringException
     */
    public function testFiltersEventsByDateRange(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        TestHelper::createEvent(self::$em, $cal, ['name' => 'Before Range', 'date' => '2026-05-01']);
        TestHelper::createEvent(self::$em, $cal, ['name' => 'In Range',     'date' => '2026-06-15']);
        TestHelper::createEvent(self::$em, $cal, ['name' => 'After Range',  'date' => '2026-08-01']);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/events?from=2026-06-01&to=2026-06-30", [], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertCount(1, $r['body']);
        $this->assertSame('In Range', $r['body'][0]['name']);
    }

    /**
     * @throws \DateMalformedStringException
     */
    public function testCreatesEventsFromTemplate(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $tmpl = TestHelper::createTemplate(self::$em, $cal, ['name' => 'Weekly Training']);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/events/from-template", [
            'templateId' => $tmpl->getId(),
            'dates' => ['2026-07-01', '2026-07-08', '2026-07-15'],
        ], $auth);
        $this->assertSame(201, $r['status']);
        $this->assertCount(3, $r['body']);
        $this->assertSame('Weekly Training', $r['body'][0]['name']);
    }

    public function testReturns403ForNonMember(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $other = TestHelper::createUser(self::$em, self::$hasher, 'other@example.com');
        $auth = TestHelper::authHeader($other, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/events", [], $auth);
        $this->assertSame(403, $r['status']);
    }

    public function testReturns400ForInvalidFromDate(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/events?from=notadate", [], $auth);
        $this->assertSame(400, $r['status']);
    }
}
