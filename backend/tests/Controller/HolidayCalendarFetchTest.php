<?php

declare(strict_types=1);

namespace App\Tests\Controller;

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

        $http = new MockHttpClient(function (): MockResponse {
            return new MockResponse(array_shift($this->feeds) ?? '', ['http_code' => 200]);
        });
        $container->set(HolidayCalendarService::class, new HolidayCalendarService($http, $this->em));
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
}
