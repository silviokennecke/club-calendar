<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Enum\ClubRole;
use App\Enum\HolidaySource;
use App\Service\CalendarVersionBumper;
use App\Service\HolidayCalendarService;
use App\Service\OpenHolidaysClient;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\NullLogger;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\Clock\MockClock;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Predefined OpenHolidays calendars (HTTP client mocked, no network). */
class HolidayOpenHolidaysTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private UserPasswordHasherInterface $hasher;
    private TokenService $tokens;
    private MockClock $clock;
    private HolidayCalendarService $service;

    /** @var list<array{string, array}> requested [url, query] */
    private array $requests = [];
    private bool $fail = false;

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
        $this->requests = [];
        $this->fail = false;
        $this->clock = new MockClock('2026-10-28 12:00:00');

        $http = new MockHttpClient(function (string $method, string $url, array $options): MockResponse {
            parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
            $this->requests[] = [(string) parse_url($url, PHP_URL_PATH), $query];
            if ($this->fail) {
                return new MockResponse('boom', ['http_code' => 500]);
            }
            $path = parse_url($url, PHP_URL_PATH);

            return new MockResponse(json_encode(match ($path) {
                '/Countries' => [['isoCode' => 'DE', 'name' => [['language' => 'DE', 'text' => 'Deutschland']]]],
                '/Subdivisions' => [['code' => 'DE-BY', 'name' => [['language' => 'DE', 'text' => 'Bayern']], 'children' => []]],
                '/PublicHolidays' => [
                    ['id' => 'p1', 'startDate' => '2026-12-25', 'endDate' => '2026-12-25', 'name' => [['language' => 'EN', 'text' => 'Christmas'], ['language' => 'DE', 'text' => 'Weihnachten']]],
                ],
                '/SchoolHolidays' => [
                    ['id' => 's1', 'startDate' => '2026-12-23', 'endDate' => '2027-01-05', 'name' => [['language' => 'DE', 'text' => 'Weihnachtsferien']]],
                ],
                default => [],
            }), ['http_code' => 200]);
        });
        $this->service = new HolidayCalendarService(
            $http,
            $this->em,
            new CalendarVersionBumper($this->em->getConnection()),
            new OpenHolidaysClient($http, new ArrayAdapter()),
            $this->clock,
            new ArrayAdapter(),
            new NullLogger(),
        );
        $container->set(HolidayCalendarService::class, $this->service);
        $container->set(OpenHolidaysClient::class, new OpenHolidaysClient($http, new ArrayAdapter()));
    }

    private function setup2(): array
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $user->setLanguage('de');
        $this->em->flush();

        return [$cal, TestHelper::authHeader($user, $this->tokens), $user];
    }

    public function testCreatePredefinedMakesOneCalendarAndOneRequestPerKind(): void
    {
        [$cal, $auth] = $this->setup2();
        $r = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars/predefined", [
            'country' => 'de', 'subdivision' => 'DE-BY', 'regionName' => 'Bayern', 'kinds' => ['public', 'school'],
        ], $auth);

        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertCount(2, $r['body']);
        $this->assertSame(['Bayern – Feiertage', 'Bayern – Schulferien'], array_column($r['body'], 'name'));
        $this->assertSame(['public', 'school'], array_column($r['body'], 'type'));
        $this->assertSame(['openholidays', 'openholidays'], array_column($r['body'], 'source'));
        $this->assertSame('DE', $r['body'][0]['sourceCountry']);
        $this->assertSame('DE-BY', $r['body'][0]['sourceSubdivision']);
        $this->assertSame('de', $r['body'][0]['sourceLanguage']);
        $this->assertNull($r['body'][0]['url']);

        $this->assertSame(['/PublicHolidays', '/SchoolHolidays'], array_column($this->requests, 0));
        $q = $this->requests[0][1];
        $year = (int) date('Y');
        $this->assertSame('DE', $q['countryIsoCode']);
        $this->assertSame('DE-BY', $q['subdivisionCode']);
        $this->assertSame('DE', $q['languageIsoCode']);
        $this->assertSame($year.'-01-01', $q['validFrom']);
        $this->assertSame(($year + 2).'-12-31', $q['validTo']);

        $this->em->clear();
        $events = $this->em->getRepository(HolidayEvent::class)->findBy([], ['date' => 'ASC']);
        $this->assertSame(['Weihnachtsferien', 'Weihnachten'], array_map(fn ($e) => $e->getName(), $events));
        $this->assertSame('2027-01-05', $events[0]->getDateEnd()->format('Y-m-d'));
        $this->assertNull($events[1]->getDateEnd());
    }

    public function testCreatePredefinedFailureStoresNothing(): void
    {
        [$cal, $auth] = $this->setup2();
        $this->fail = true;
        $r = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/holiday-calendars/predefined", [
            'country' => 'DE', 'kinds' => ['public'],
        ], $auth);

        $this->assertSame(422, $r['status']);
        $this->assertSame('holiday_source_failed', $r['body']['code']);
        $this->em->clear();
        $this->assertCount(0, $this->em->getRepository(HolidayCalendar::class)->findAll());
    }

    public function testCreatePredefinedValidatesKindsAndRole(): void
    {
        [$cal, $auth] = $this->setup2();
        $url = "/api/calendars/{$cal->getId()}/holiday-calendars/predefined";
        $bad = TestHelper::jsonRequest($this->client, 'POST', $url, ['country' => 'DE', 'kinds' => ['other']], $auth);
        $this->assertSame(422, $bad['status']);
        $this->assertSame('kinds', $bad['body']['field']);

        $viewer = TestHelper::createUser($this->em, $this->hasher);
        TestHelper::addMember($this->em, $cal->getClub(), $viewer, ClubRole::VIEWER);
        $viewerAuth = TestHelper::authHeader($viewer, $this->tokens);
        $this->assertSame(403, TestHelper::jsonRequest($this->client, 'POST', $url, ['country' => 'DE', 'kinds' => ['public']], $viewerAuth)['status']);
        $this->assertSame(401, TestHelper::jsonRequest($this->client, 'POST', $url, ['country' => 'DE', 'kinds' => ['public']])['status']);
        $this->assertSame([], $this->requests);
    }

    public function testRefreshEndpointRefetchesFromApi(): void
    {
        [$cal, $auth] = $this->setup2();
        $base = "/api/calendars/{$cal->getId()}/holiday-calendars";
        $created = TestHelper::jsonRequest($this->client, 'POST', "$base/predefined", ['country' => 'DE', 'kinds' => ['public']], $auth);
        $id = $created['body'][0]['id'];
        $this->requests = [];

        $r = TestHelper::jsonRequest($this->client, 'POST', "$base/$id/refresh", [], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(1, $r['body']['eventCount']);
        $this->assertSame(['/PublicHolidays'], array_column($this->requests, 0));
    }

    public function testRefreshIfStaleOnlyWhenOlderThanThreeMonthsAndOncePerHour(): void
    {
        [$cal] = $this->setup2();
        $hc = new HolidayCalendar($cal, 'Feiertage', null);
        $hc->useOpenHolidays('DE', null, 'de');
        $hc->setType(\App\Enum\HolidayType::PUBLIC);
        $hc->setLastFetchedAt(new \DateTimeImmutable('2026-09-01'));
        $this->em->persist($hc);
        $this->em->flush();

        $this->service->refreshIfStale($hc);
        $this->assertSame([], $this->requests, 'fresh calendar is not refreshed');

        $hc->setLastFetchedAt(new \DateTimeImmutable('2026-06-01'));
        $this->fail = true;
        $this->service->refreshIfStale($hc);
        $this->assertCount(1, $this->requests);
        $this->service->refreshIfStale($hc);
        $this->assertCount(1, $this->requests, 'failed attempt is not retried within the hour');

        $this->fail = false;
        $other = new HolidayCalendar($cal, 'Ferien', null);
        $other->useOpenHolidays('DE', null, 'de');
        $other->setType(\App\Enum\HolidayType::SCHOOL);
        $this->em->persist($other);
        $this->em->flush();
        $this->service->refreshIfStale($other);
        $this->assertSame(HolidaySource::OPENHOLIDAYS, $other->getSource());
        $this->assertNotNull($other->getLastFetchedAt());
        $this->assertCount(2, $this->requests);
    }

    public function testHolidayEventsReadTriggersStaleRefresh(): void
    {
        [$cal, $auth] = $this->setup2();
        $hc = new HolidayCalendar($cal, 'Feiertage', null);
        $hc->useOpenHolidays('DE', null, 'de');
        $hc->setType(\App\Enum\HolidayType::PUBLIC);
        $this->em->persist($hc);
        $this->em->flush();

        $r = TestHelper::jsonRequest($this->client, 'GET', "/api/calendars/{$cal->getId()}/holiday-events?from=2026-12-01&to=2026-12-31", [], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['Weihnachten'], array_column($r['body'], 'name'));
    }

    public function testTypeOnIcsCalendarCreateAndPatch(): void
    {
        [$cal, $auth] = $this->setup2();
        $hc = new HolidayCalendar($cal, 'X', 'https://example.com/x.ics');
        $this->em->persist($hc);
        $this->em->flush();
        $base = "/api/calendars/{$cal->getId()}/holiday-calendars";

        $list = TestHelper::jsonRequest($this->client, 'GET', $base, [], $auth);
        $this->assertSame('other', $list['body'][0]['type']);
        $this->assertSame('ics', $list['body'][0]['source']);

        $this->em->clear();
        $r = TestHelper::jsonRequest($this->client, 'PATCH', "$base/{$hc->getId()}", ['type' => 'school'], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame('school', $r['body']['type']);
        $bad = TestHelper::jsonRequest($this->client, 'PATCH', "$base/{$hc->getId()}", ['type' => 'nope'], $auth);
        $this->assertSame(422, $bad['status']);
    }

    public function testSourceListsAreCachedAndRequireEditor(): void
    {
        [, $auth] = $this->setup2();
        $c = TestHelper::jsonRequest($this->client, 'GET', '/api/holiday-sources/countries', [], $auth);
        $this->assertSame(200, $c['status'], $c['content']);
        $this->assertSame([['isoCode' => 'DE', 'name' => 'Deutschland']], $c['body']);
        $s = TestHelper::jsonRequest($this->client, 'GET', '/api/holiday-sources/countries/de/subdivisions', [], $auth);
        $this->assertSame(200, $s['status'], $s['content']);
        $this->assertSame('DE-BY', $s['body'][0]['code']);
        $this->assertSame('DE', $this->requests[1][1]['countryIsoCode']);
        $this->assertSame('DE', $this->requests[0][1]['languageIsoCode']);

        $this->assertSame(401, TestHelper::jsonRequest($this->client, 'GET', '/api/holiday-sources/countries')['status']);

        $owner = TestHelper::createUser($this->em, $this->hasher);
        $viewer = TestHelper::createUser($this->em, $this->hasher);
        TestHelper::addMember($this->em, TestHelper::createClub($this->em, $owner, 'Other'), $viewer, ClubRole::VIEWER);
        $this->assertSame(403, TestHelper::jsonRequest($this->client, 'GET', '/api/holiday-sources/countries', [], TestHelper::authHeader($viewer, $this->tokens))['status']);
    }
}
