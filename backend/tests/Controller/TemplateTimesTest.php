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
 * Templates without times (timezone, timeBegin, timeEnd are optional): the rule for events created
 * from them is "no times in the template and none in the request -> all-day event (00:00 – 23:59)".
 */
class TemplateTimesTest extends WebTestCase
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

    /** @return array{string, string, string, string} auth, calendar base path, club id, calendar id */
    private function setupCalendar(): array
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);

        return [TestHelper::authHeader($user, self::$tokens), "/api/calendars/{$cal->getId()}", $club->getId(), $cal->getId()];
    }

    /** @return array{status: int, body: mixed, content: string} */
    private function req(string $method, string $uri, string $auth, array $data = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $data, $auth);
    }

    public function testTemplateWithoutTimesCanBeCreatedReadAndListed(): void
    {
        [$auth, $base] = $this->setupCalendar();

        $create = $this->req('POST', "$base/templates", $auth, ['name' => 'Vereinsfest']);
        $this->assertSame(201, $create['status']);
        $this->assertNull($create['body']['timezone']);
        $this->assertNull($create['body']['timeBegin']);
        $this->assertNull($create['body']['timeEnd']);
        $id = $create['body']['id'];
        self::$em->clear();

        $this->assertNull($this->req('GET', "$base/templates/$id", $auth)['body']['timeBegin']);
        $this->assertSame(200, $this->req('GET', "$base/templates", $auth)['status']);

        // Times can be added and removed again
        $patch = $this->req('PATCH', "$base/templates/$id", $auth, ['timeBegin' => '19:00', 'timeEnd' => '21:00', 'timezone' => 'Europe/Berlin']);
        $this->assertSame(200, $patch['status']);
        $this->assertSame(['19:00', '21:00', 'Europe/Berlin'], [$patch['body']['timeBegin'], $patch['body']['timeEnd'], $patch['body']['timezone']]);
        $patch = $this->req('PATCH', "$base/templates/$id", $auth, ['timeBegin' => null, 'timeEnd' => '', 'timezone' => null]);
        $this->assertSame(200, $patch['status']);
        $this->assertSame([null, null, null], [$patch['body']['timeBegin'], $patch['body']['timeEnd'], $patch['body']['timezone']]);
    }

    public function testTemplateTimesComeInPairs(): void
    {
        [$auth, $base] = $this->setupCalendar();

        $this->assertSame(400, $this->req('POST', "$base/templates", $auth, ['name' => 'Halb', 'timeBegin' => '19:00'])['status']);
        $this->assertSame(400, $this->req('POST', "$base/templates", $auth, ['name' => 'Halb', 'timeEnd' => '21:00'])['status']);
        $this->assertSame(400, $this->req('POST', "$base/templates", $auth, ['name' => 'Kaputt', 'timeBegin' => '25:00', 'timeEnd' => '21:00'])['status']);
        $this->assertSame(400, $this->req('POST', "$base/templates", $auth, ['name' => 'Zone', 'timezone' => 'Mars/Base'])['status']);

        $id = $this->req('POST', "$base/templates", $auth, ['name' => 'Ganz', 'timeBegin' => '19:00', 'timeEnd' => '21:00'])['body']['id'];
        $this->assertSame(400, $this->req('PATCH', "$base/templates/$id", $auth, ['timeEnd' => null])['status']);
    }

    public function testEventFromATemplateWithoutTimesIsAllDay(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $id = $this->req('POST', "$base/templates", $auth, ['name' => 'Vereinsfest'])['body']['id'];

        $r = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $id, 'dates' => ['2026-10-24']]);
        $this->assertSame(201, $r['status']);
        $event = $r['body'][0];
        $this->assertTrue($event['isAllDay']);
        $this->assertSame(['00:00', '23:59'], [$event['timeBegin'], $event['timeEnd']]);
        $this->assertNull($event['timezone']);
        $this->assertSame($id, $event['eventTemplateId']);
    }

    public function testRequestTimesWinOverATemplateWithoutTimes(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $id = $this->req('POST', "$base/templates", $auth, ['name' => 'Vereinsfest'])['body']['id'];

        $r = $this->req('POST', "$base/events/from-template", $auth, [
            'templateId' => $id, 'dates' => ['2026-10-24'], 'overrides' => ['timeBegin' => '15:00', 'timeEnd' => '18:00'],
        ]);
        $this->assertSame(201, $r['status']);
        $this->assertFalse($r['body'][0]['isAllDay']);
        $this->assertSame(['15:00', '18:00'], [$r['body'][0]['timeBegin'], $r['body'][0]['timeEnd']]);

        // Explicitly not all-day, but no times anywhere: a clear 400 instead of a guessed time
        $r = $this->req('POST', "$base/events/from-template", $auth, [
            'templateId' => $id, 'dates' => ['2026-10-24'], 'overrides' => ['isAllDay' => false],
        ]);
        $this->assertSame(400, $r['status']);
    }

    public function testTemplateWithTimesKeepsCreatingTimedEvents(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $id = $this->req('POST', "$base/templates", $auth, ['name' => 'Training', 'timeBegin' => '18:00', 'timeEnd' => '20:00'])['body']['id'];

        $r = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $id, 'dates' => ['2026-10-24']]);
        $this->assertSame(201, $r['status']);
        $this->assertFalse($r['body'][0]['isAllDay']);
        $this->assertSame(['18:00', '20:00'], [$r['body'][0]['timeBegin'], $r['body'][0]['timeEnd']]);
    }

    public function testListsFeedsAndDuplicatesWorkWithTemplatesWithoutTimes(): void
    {
        [$auth, $base, $clubId, $calId] = $this->setupCalendar();
        $id = $this->req('POST', "$base/templates", $auth, ['name' => 'Vereinsfest'])['body']['id'];
        $events = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $id, 'dates' => ['2026-10-24']])['body'];
        $this->req('PATCH', "$base/events/{$events[0]['id']}", $auth, ['isDraft' => false]);
        $feed = $this->req('POST', "/api/clubs/$clubId/feeds", $auth, ['name' => 'Alle', 'visibility' => FeedVisibility::PUBLIC->value, 'calendarIds' => [$calId]])['body'];

        $this->assertSame(200, $this->req('GET', "$base/events?from=2026-10-01&to=2026-10-31", $auth)['status']);
        $public = TestHelper::jsonRequest(self::$client, 'GET', "/api/feed/{$feed['id']}/events");
        $this->assertSame(200, $public['status']);
        $this->assertTrue($public['body']['events'][0]['isAllDay']);
        self::$client->request('GET', "/api/feed/{$feed['id']}/ics");
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
        $this->assertStringContainsString('DTSTART;VALUE=DATE:20261024', (string) self::$client->getInternalResponse()->getContent());

        $copy = $this->req('POST', "/api/clubs/$clubId/calendars/$calId/duplicate", $auth);
        $this->assertSame(201, $copy['status']);
        $templates = $this->req('GET', "/api/calendars/{$copy['body']['id']}/templates", $auth)['body'];
        $this->assertNull($templates[0]['timeBegin']);
        $this->assertSame(1, self::$em->getRepository(CalendarFeed::class)->count(['name' => 'Alle']), 'feeds are not copied');
    }
}
