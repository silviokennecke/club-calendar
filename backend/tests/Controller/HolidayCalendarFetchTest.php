<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\HolidayCalendar;
use App\Service\HolidayCalendarService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Create / refresh of a holiday calendar with a fetched ICS feed (HTTP client mocked): the responses
 * carry the number of stored holidays.
 */
class HolidayCalendarFetchTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private UserPasswordHasherInterface $hasher;
    private TokenService $tokens;

    /** @var list<string> ICS bodies served one after the other */
    private array $feeds = [];

    /** @var (callable(string, string, array<string, mixed>): MockResponse)|null */
    private $handler;

    protected function setUp(): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $container = static::getContainer();
        $this->em = $container->get(EntityManagerInterface::class);
        $this->hasher = $container->get(UserPasswordHasherInterface::class);
        $this->tokens = $container->get(TokenService::class);
        DatabaseResetter::reset($this->em);

        $http = new MockHttpClient(
            fn (string $method, string $url, array $options): MockResponse => null !== $this->handler
                ? ($this->handler)($method, $url, $options)
                : new MockResponse(array_shift($this->feeds) ?? '', ['http_code' => 200]),
        );
        $container->set(HolidayCalendarService::class, new HolidayCalendarService(
            $http,
            $this->em,
            new \App\Service\CalendarVersionBumper($this->em->getConnection()),
            new \App\Service\OpenHolidaysClient($http, new \Symfony\Component\Cache\Adapter\ArrayAdapter()),
            new \Symfony\Component\Clock\NativeClock(),
            new \Symfony\Component\Cache\Adapter\ArrayAdapter(),
            new \Psr\Log\NullLogger(),
        ));
    }

    private static function ics(int $holidays): string
    {
        $events = '';
        for ($i = 1; $i <= $holidays; ++$i) {
            $events .= sprintf("BEGIN:VEVENT\r\nUID:h%d@test\r\nSUMMARY:Feiertag %d\r\nDTSTART;VALUE=DATE:202612%02d\r\nEND:VEVENT\r\n", $i, $i, $i);
        }

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Test//EN\r\n{$events}END:VCALENDAR\r\n";
    }

    public function testCreateAndRefreshReportTheStoredHolidays(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $base = "/api/calendars/{$cal->getId()}/holiday-calendars";
        $this->feeds = [self::ics(3), self::ics(2)];

        $created = TestHelper::jsonRequest($this->client, 'POST', $base, [
            'name' => 'Feiertage', 'url' => 'https://holidays.invalid/feiertage.ics',
        ], $auth);
        $this->assertSame(201, $created['status'], $created['content']);
        $this->assertSame(3, $created['body']['eventCount']);
        $this->assertNotNull($created['body']['lastFetchedAt']);

        $this->em->clear();
        $list = TestHelper::jsonRequest($this->client, 'GET', $base, [], $auth);
        $this->assertSame([3], array_column($list['body'], 'eventCount'));

        $refreshed = TestHelper::jsonRequest($this->client, 'POST', "$base/{$created['body']['id']}/refresh", [], $auth);
        $this->assertSame(200, $refreshed['status'], $refreshed['content']);
        $this->assertSame(2, $refreshed['body']['eventCount']);

        $this->em->clear();
        $list = TestHelper::jsonRequest($this->client, 'GET', $base, [], $auth);
        $this->assertSame([2], array_column($list['body'], 'eventCount'));
    }

    public function testOversizedFeedIsRefused(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        // A comment line pads the body past the 1 MB limit
        $this->feeds = [str_replace('END:VCALENDAR', 'X-PAD:'.str_repeat('a', HolidayCalendarService::MAX_BYTES)."\r\nEND:VCALENDAR", self::ics(1))];

        $r = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars", [
            'name' => 'Gross', 'url' => 'https://holidays.invalid/gross.ics',
        ], $auth);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('ics_fetch_failed', $r['body']['code']);
    }

    public function testFeedWithTooManyEventsIsRefused(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $events = '';
        for ($i = 0; $i <= HolidayCalendarService::MAX_EVENTS; ++$i) {
            $events .= "BEGIN:VEVENT\r\nUID:h$i@t\r\nDTSTART;VALUE=DATE:20261201\r\nEND:VEVENT\r\n";
        }
        $this->feeds = ["BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//T//T//EN\r\n{$events}END:VCALENDAR\r\n"];

        $r = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars", [
            'name' => 'Viele', 'url' => 'https://holidays.invalid/viele.ics',
        ], $auth);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('ics_fetch_failed', $r['body']['code']);
    }

    public function testRequestCapsRedirectsAndFetchRunsOutsideATransaction(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $seen = [];
        $conn = $this->em->getConnection();
        $this->handler = function (string $method, string $url, array $options) use (&$seen, $conn): MockResponse {
            $seen[] = ['max_redirects' => $options['max_redirects'] ?? null, 'tx' => $conn->isTransactionActive()];

            return new MockResponse(self::ics(1), ['http_code' => 200]);
        };

        $r = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars", [
            'name' => 'F', 'url' => 'https://holidays.invalid/f.ics',
        ], $auth);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame([['max_redirects' => 3, 'tx' => false]], $seen);
    }

    /** Service wired like production: the mock sits behind the private-network guard (IP-literal URLs: no DNS). */
    private function guardedService(callable $handler): HolidayCalendarService
    {
        $http = new \Symfony\Component\HttpClient\NoPrivateNetworkHttpClient(new MockHttpClient($handler));

        return new HolidayCalendarService(
            $http,
            $this->em,
            new \App\Service\CalendarVersionBumper($this->em->getConnection()),
            new \App\Service\OpenHolidaysClient($http, new \Symfony\Component\Cache\Adapter\ArrayAdapter()),
            new \Symfony\Component\Clock\NativeClock(),
            new \Symfony\Component\Cache\Adapter\ArrayAdapter(),
            new \Psr\Log\NullLogger(),
        );
    }

    public function testTooManyRedirectsAreRefused(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $hops = 0;
        $service = $this->guardedService(function () use (&$hops): MockResponse {
            ++$hops;

            return new MockResponse('', ['http_code' => 302, 'redirect_url' => 'https://93.184.216.34/next'.$hops]);
        });

        try {
            $service->createAndStore(new HolidayCalendar($cal, 'F', 'https://93.184.216.34/f.ics'));
            $this->fail('Expected the redirect chain to be refused');
        } catch (\Symfony\Contracts\HttpClient\Exception\ExceptionInterface) {
        }
        $this->assertSame(HolidayCalendarService::MAX_REDIRECTS + 1, $hops);
        $this->assertSame(0, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM holiday_calendar'));
    }

    public function testRedirectToInternalAddressIsRefused(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $requested = [];
        $service = $this->guardedService(function (string $m, string $url) use (&$requested): MockResponse {
            $requested[] = $url;

            return 'https://93.184.216.34/f.ics' === $url
                ? new MockResponse('', ['http_code' => 302, 'redirect_url' => 'http://169.254.169.254/latest/meta-data'])
                : new MockResponse(self::ics(1), ['http_code' => 200]);
        });

        try {
            $service->createAndStore(new HolidayCalendar($cal, 'F', 'https://93.184.216.34/f.ics'));
            $this->fail('Expected the redirect to the internal address to be refused');
        } catch (\Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface) {
        }
        $this->assertSame(['https://93.184.216.34/f.ics'], $requested);
        $this->assertSame(0, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM holiday_calendar'));
    }

    public function testFailedRefreshKeepsStoredHolidays(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $base = "/api/calendars/{$cal->getId()}/holiday-calendars";
        $this->feeds = [self::ics(3)];
        $created = TestHelper::jsonRequest($this->client, 'POST', $base, ['name' => 'F', 'url' => 'https://holidays.invalid/f.ics'], $auth);
        $this->assertSame(201, $created['status'], $created['content']);

        $this->handler = static fn (): MockResponse => new MockResponse('nope', ['http_code' => 500]);
        $r = TestHelper::jsonRequest($this->client, 'POST', "$base/{$created['body']['id']}/refresh", [], $auth);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('ics_fetch_failed', $r['body']['code']);
        $this->assertSame(3, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM holiday_event'));
    }

    public function testUserFetchIsThrottled(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $base = "/api/calendars/{$cal->getId()}/holiday-calendars";
        $this->feeds = [self::ics(1)];
        $created = TestHelper::jsonRequest($this->client, 'POST', $base, ['name' => 'F', 'url' => 'https://holidays.invalid/f.ics'], $auth);
        $this->assertSame(201, $created['status'], $created['content']);

        static::getContainer()->get('limiter.holiday_fetch_user')->create($user->getId())->consume(999);

        $r = TestHelper::jsonRequest($this->client, 'POST', "$base/{$created['body']['id']}/refresh", [], $auth);
        $this->assertSame(429, $r['status'], $r['content']);
        $this->assertSame('rate_limited', $r['body']['code']);
        $this->assertNotEmpty($r['headers']['retry-after'][0]);
        $r = TestHelper::jsonRequest($this->client, 'POST', $base, ['name' => 'G', 'url' => 'https://holidays.invalid/g.ics'], $auth);
        $this->assertSame(429, $r['status'], $r['content']);
    }
}
