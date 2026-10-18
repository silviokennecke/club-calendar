<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Event;
use App\Entity\EventTargetGroup;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\QueryCounter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Member ICS export (`GET …/events.ics`) and bulk actions (`POST …/events/bulk`).
 */
class ExportBulkTest extends WebTestCase
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

    /** @return array{auth: string, base: string, calendar: Calendar} */
    private function setupCalendar(string $name = 'Schießbetrieb 2026'): array
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        self::$em->find(Calendar::class, $cal->getId())?->setName($name);
        self::$em->flush();

        return ['auth' => TestHelper::authHeader($user, self::$tokens), 'base' => "/api/calendars/{$cal->getId()}", 'calendar' => $cal];
    }

    /** @return array{status: int, content: string, headers: array<string, list<string>>, body: mixed} */
    private function get(string $uri, string $auth): array
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', $uri, [], $auth);
        self::$em->clear();

        return $r;
    }

    private function create(string $base, string $auth, array $data): string
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $data + [
            'date' => '2026-10-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00', 'isDraft' => false,
        ], $auth);
        $this->assertSame(201, $r['status'], $r['content']);

        return $r['body']['id'];
    }

    // --- export ---

    public function testMembersDownloadTheCalendarAsIcsFile(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $prop = TestHelper::jsonRequest(self::$client, 'POST', $base.'/properties', ['name' => 'Wettkampf', 'icon' => '🏆'], $auth)['body']['id'];
        $this->create($base, $auth, ['name' => 'Vereinsmeisterschaft', 'timezone' => 'Europe/Berlin', 'propertyIds' => [$prop]]);
        $this->create($base, $auth, ['name' => 'Vorstandssitzung', 'isDraft' => true, 'date' => '2026-10-07']);

        $r = $this->get("$base/events.ics", $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertStringStartsWith('text/calendar', $r['headers']['content-type'][0]);
        $this->assertSame('attachment; filename=schiessbetrieb-2026.ics', $r['headers']['content-disposition'][0]);
        $this->assertStringContainsString('BEGIN:VCALENDAR', $r['content']);
        $this->assertStringContainsString('BEGIN:VTIMEZONE', $r['content']);
        $this->assertStringContainsString('SUMMARY:🏆 Vereinsmeisterschaft', $r['content']);
        $this->assertStringNotContainsString('Vorstandssitzung', $r['content'], 'drafts only on request');
        $this->assertStringNotContainsString('STATUS:', $r['content']);

        $r = $this->get("$base/events.ics?includeDrafts=1", $auth);
        $this->assertStringContainsString('SUMMARY:Vorstandssitzung', $r['content']);
        $this->assertSame(1, substr_count($r['content'], 'STATUS:TENTATIVE'));
        $r = $this->get("$base/events.ics?includeDrafts=false", $auth);
        $this->assertStringNotContainsString('Vorstandssitzung', $r['content']);
    }

    public function testExportFiltersByOverlappingRangeAndTargetGroups(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $youth = TestHelper::jsonRequest(self::$client, 'POST', TestHelper::clubBase(self::$em, $base).'/target-groups', ['name' => 'Jugend'], $auth)['body']['id'];
        $adults = TestHelper::jsonRequest(self::$client, 'POST', TestHelper::clubBase(self::$em, $base).'/target-groups', ['name' => 'Erwachsene'], $auth)['body']['id'];
        $this->create($base, $auth, ['name' => 'Zeltlager', 'date' => '2026-09-28', 'dateEnd' => '2026-10-02', 'targetGroupIds' => [$youth]]);
        $this->create($base, $auth, ['name' => 'Herbstfest', 'date' => '2026-10-24', 'targetGroupIds' => [$adults]]);
        $this->create($base, $auth, ['name' => 'Silvester', 'date' => '2026-12-31']);

        $r = $this->get("$base/events.ics?from=2026-10-01&to=2026-10-31", $auth);
        $this->assertStringContainsString('Zeltlager', $r['content'], 'multi-day event reaching into the range');
        $this->assertStringContainsString('Herbstfest', $r['content']);
        $this->assertStringNotContainsString('Silvester', $r['content']);

        $r = $this->get("$base/events.ics?targetGroupIds[]=$youth", $auth);
        $this->assertStringContainsString('Zeltlager', $r['content']);
        $this->assertStringNotContainsString('Herbstfest', $r['content']);
        $r = $this->get("$base/events.ics?targetGroupIds[]=$youth&targetGroupIds[]=$adults", $auth);
        $this->assertStringContainsString('Herbstfest', $r['content']);
        $this->assertStringNotContainsString('Silvester', $r['content']);

        // Target groups of another calendar (or unknown ones) are rejected, not ignored
        $otherUser = TestHelper::createUser(self::$em, self::$hasher);
        $otherClub = TestHelper::createClub(self::$em, $otherUser, 'Fremder Verein');
        $foreign = TestHelper::jsonRequest(self::$client, 'POST', "/api/clubs/{$otherClub->getId()}/target-groups", ['name' => 'Fremd'], TestHelper::authHeader($otherUser, self::$tokens))['body']['id'];
        $r = $this->get("$base/events.ics?targetGroupIds[]=$foreign", $auth);
        $this->assertSame(422, $r['status']);
        $this->assertSame('unknown_reference', $r['body']['code']);
    }

    public function testExportRejectsInvalidParametersAndStrangers(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar();
        foreach (['from=2026-13-01', 'to=morgen', 'from=2026-10-10&to=2026-10-01', 'includeDrafts=vielleicht', 'from[]=2026-10-01'] as $query) {
            $r = $this->get("$base/events.ics?$query", $auth);
            $this->assertSame(400, $r['status'], $query.' -> '.$r['content']);
        }
        $stranger = TestHelper::authHeader(TestHelper::createUser(self::$em, self::$hasher), self::$tokens);
        $this->assertSame(403, $this->get("$base/events.ics", $stranger)['status']);
        $this->assertContains($this->get("$base/events.ics", '')['status'], [401, 403]);
    }

    public function testExportFileNameIsSafe(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar("../\"Böse\"\r\nX-Header: 1");
        $r = $this->get("$base/events.ics", $auth);
        $this->assertSame('attachment; filename=bose-x-header-1.ics', $r['headers']['content-disposition'][0]);
        $this->assertArrayNotHasKey('x-header', $r['headers']);
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar('🎯');
        $this->assertSame('attachment; filename=termine.ics', $this->get("$base/events.ics", $auth)['headers']['content-disposition'][0]);
    }

    public function testExportRunsTheSameNumberOfQueriesForMoreEvents(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $tg = TestHelper::jsonRequest(self::$client, 'POST', TestHelper::clubBase(self::$em, $base).'/target-groups', ['name' => 'Jugend'], $auth)['body']['id'];
        $prop = TestHelper::jsonRequest(self::$client, 'POST', $base.'/properties', ['name' => 'Draußen', 'icon' => '🌳'], $auth)['body']['id'];
        $loc = TestHelper::jsonRequest(self::$client, 'POST', TestHelper::clubBase(self::$em, $base).'/locations', ['name' => 'Halle', 'latitude' => 51.1, 'longitude' => 7.2], $auth)['body']['id'];
        $data = ['name' => 'T', 'targetGroupIds' => [$tg], 'propertyIds' => [$prop], 'locationId' => $loc];
        $this->create($base, $auth, $data);

        QueryCounter::$count = 0;
        $this->get("$base/events.ics", $auth);
        $one = QueryCounter::$count;
        foreach (range(2, 6) as $i) {
            $this->create($base, $auth, $data + ['date' => "2026-10-0$i"]);
        }
        QueryCounter::$count = 0;
        $r = $this->get("$base/events.ics", $auth);
        $this->assertSame(6, substr_count($r['content'], 'BEGIN:VEVENT'));
        $this->assertSame($one, QueryCounter::$count, 'no query per event');
    }

    // --- bulk ---

    private function bulk(string $base, string $auth, mixed $ids, mixed $action): array
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/bulk", ['ids' => $ids, 'action' => $action], $auth);
        self::$em->clear();

        return $r;
    }

    private function drafts(array $ids): array
    {
        return array_map(fn ($id) => self::$em->find(Event::class, $id)?->isDraft(), $ids);
    }

    public function testBulkPublishesUnpublishesAndDeletes(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $tg = TestHelper::jsonRequest(self::$client, 'POST', TestHelper::clubBase(self::$em, $base).'/target-groups', ['name' => 'Jugend'], $auth)['body']['id'];
        $ids = array_map(fn ($i) => $this->create($base, $auth, ['name' => "T$i", 'isDraft' => true, 'targetGroupIds' => [$tg]]), [1, 2, 3]);

        $r = $this->bulk($base, $auth, [$ids[0], $ids[1], $ids[0], strtoupper($ids[1])], 'publish');
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['affected' => 2], $r['body']);
        $this->assertSame([false, false, true], $this->drafts($ids));

        $r = $this->bulk($base, $auth, [$ids[1]], 'draft');
        $this->assertSame(['affected' => 1], $r['body']);
        $this->assertSame([false, true, true], $this->drafts($ids));

        $r = $this->bulk($base, $auth, [$ids[0], $ids[2]], 'delete');
        $this->assertSame(['affected' => 2], $r['body']);
        $this->assertNull(self::$em->find(Event::class, $ids[0]));
        $this->assertNotNull(self::$em->find(Event::class, $ids[1]));
        $links = self::$em->getRepository(EventTargetGroup::class)->findAll();
        $this->assertCount(1, $links, 'assignments of deleted events are gone');
    }

    public function testBulkIsAllOrNothingAndStaysInTheCalendar(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $own = $this->create($base, $auth, ['name' => 'Eigen', 'isDraft' => true]);
        $other = TestHelper::createCalendar(self::$em, $cal->getClub(), 'Anderer');
        $foreign = $this->create("/api/calendars/{$other->getId()}", $auth, ['name' => 'Fremd', 'isDraft' => true]);

        foreach (['publish', 'delete'] as $action) {
            foreach ([$foreign, '00000000-0000-0000-0000-000000000000'] as $bad) {
                $r = $this->bulk($base, $auth, [$own, $bad], $action);
                $this->assertSame(422, $r['status'], "$action $bad");
                $this->assertSame('unknown_reference', $r['body']['code']);
                $this->assertSame('ids', $r['body']['field']);
                $this->assertStringNotContainsString('Fremd', $r['content']);
            }
        }
        $this->assertSame([true, true], $this->drafts([$own, $foreign]), 'nothing changed');

        foreach ([[[], 'publish'], ['x', 'publish'], [[$own], 'archive'], [[$own], null], [[42], 'publish'], [['a' => $own], 'delete']] as [$ids, $action]) {
            $r = $this->bulk($base, $auth, $ids, $action);
            $this->assertSame(400, $r['status'], json_encode([$ids, $action]));
            $this->assertSame('validation_failed', $r['body']['code']);
        }
        $r = $this->bulk($base, $auth, array_map(fn ($i) => sprintf('00000000-0000-0000-0000-%012d', $i), range(1, 5001)), 'publish');
        $this->assertSame(413, $r['status']);
        $this->assertSame('too_many_events', $r['body']['code']);
        $this->assertNotNull(self::$em->find(Event::class, $own));
    }

    public function testBulkNeedsMembershipAndAnActiveCalendar(): void
    {
        ['auth' => $auth, 'base' => $base, 'calendar' => $cal] = $this->setupCalendar();
        $id = $this->create($base, $auth, ['name' => 'T', 'isDraft' => true]);
        $stranger = TestHelper::authHeader(TestHelper::createUser(self::$em, self::$hasher), self::$tokens);
        $this->assertSame(403, $this->bulk($base, $stranger, [$id], 'delete')['status']);
        self::$em->find(Calendar::class, $cal->getId())?->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
        $this->assertSame(403, $this->bulk($base, $auth, [$id], 'publish')['status']);
        $this->assertSame([true], $this->drafts([$id]));
        // Reading stays possible in the archive
        $this->assertSame(200, $this->get("$base/events.ics?includeDrafts=1", $auth)['status']);
    }
}
