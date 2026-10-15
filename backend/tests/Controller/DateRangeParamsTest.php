<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\CalendarFeed;
use App\Enum\FeedVisibility;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * `from` / `to` query parameters of the event list, the holiday events, the public feed and the member
 * ICS export: strictly YYYY-MM-DD (real calendar days), else 400 `validation_failed` with the `field`;
 * `to` before `from` is a 400 on `to`.
 */
class DateRangeParamsTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

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
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive across tests (see AuthTest).
    }

    /** @return array<string, array{0: string, 1: string}> query => expected field */
    private static function invalidQueries(): array
    {
        return [
            'from=x' => ['from=x', 'from'],
            'from=now' => ['from=now', 'from'],
            'from=tomorrow' => ['from=tomorrow', 'from'],
            'from=2026-02-31' => ['from=2026-02-31', 'from'],
            'from=2026-13-01' => ['from=2026-13-01', 'from'],
            'from=2026-6-1' => ['from=2026-6-1', 'from'],
            'from=2026-06-01T00:00' => ['from=2026-06-01T00:00', 'from'],
            'from=+2026-06-01' => ['from=%2B2026-06-01', 'from'],
            'from[]' => ['from[]=2026-06-01', 'from'],
            'to=x' => ['from=2026-06-01&to=x', 'to'],
            'to=01.10.2026' => ['from=2026-06-01&to=01.10.2026', 'to'],
            'to=2026-04-31' => ['from=2026-04-01&to=2026-04-31', 'to'],
            'to[]' => ['from=2026-06-01&to[]=2026-06-30', 'to'],
            'to before from' => ['from=2026-06-30&to=2026-06-01', 'to'],
        ];
    }

    /** @return array{base: string, auth: string, feed: string} */
    private function setupCalendar(): array
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = new CalendarFeed();
        $feed->setCalendar($cal);
        $feed->setName('Alle');
        $feed->setVisibility(FeedVisibility::PUBLIC);
        $feed->setSharedSecret('public-'.$cal->getId());
        self::$em->persist($feed);
        self::$em->flush();

        return [
            'base' => "/api/calendars/{$cal->getId()}",
            'auth' => TestHelper::authHeader($user, self::$tokens),
            'feed' => "/api/feed/{$feed->getId()}/events",
        ];
    }

    private function assertInvalid(string $url, string $field, string $auth = ''): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', $url, [], $auth);
        $this->assertSame(400, $r['status'], $url.' -> '.$r['content']);
        $this->assertSame('validation_failed', $r['body']['code'] ?? null, $url);
        $this->assertSame($field, $r['body']['field'] ?? null, $url);
    }

    public function testInvalidDatesAreRejectedEverywhere(): void
    {
        ['base' => $base, 'auth' => $auth, 'feed' => $feed] = $this->setupCalendar();
        foreach (self::invalidQueries() as [$query, $field]) {
            $this->assertInvalid("$base/events?$query", $field, $auth);
            $this->assertInvalid("$feed?$query", $field);
            $this->assertInvalid("$base/events.ics?$query", $field, $auth);
            // The holiday list needs both bounds
            $holidayQuery = str_starts_with($query, 'from') && !str_contains($query, '&') ? "$query&to=2026-06-30" : $query;
            $this->assertInvalid("$base/holiday-events?$holidayQuery", $field, $auth);
        }
    }

    public function testHolidayEventsNeedBothBounds(): void
    {
        ['base' => $base, 'auth' => $auth] = $this->setupCalendar();
        $this->assertInvalid("$base/holiday-events", 'from', $auth);
        $this->assertInvalid("$base/holiday-events?to=2026-06-30", 'from', $auth);
        $this->assertInvalid("$base/holiday-events?from=2026-06-01", 'to', $auth);
    }

    public function testValidAndEmptyRangesStillWork(): void
    {
        ['base' => $base, 'auth' => $auth, 'feed' => $feed] = $this->setupCalendar();
        foreach (['', 'from=2026-06-01', 'to=2026-06-30', 'from=2026-06-01&to=2026-06-01', 'from=2028-02-29&to=2028-03-01', 'from=&to='] as $query) {
            foreach (["$base/events?$query", "$feed?$query", "$base/events.ics?$query"] as $url) {
                $r = TestHelper::jsonRequest(self::$client, 'GET', $url, [], str_starts_with($url, '/api/feed') ? '' : $auth);
                $this->assertSame(200, $r['status'], $url.' -> '.$r['content']);
            }
        }
        $r = TestHelper::jsonRequest(self::$client, 'GET', "$base/holiday-events?from=2026-06-01&to=2026-06-30", [], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
    }
}
