<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Club;
use App\Entity\Location;
use App\Entity\Resource;
use App\Entity\User;
use App\Enum\FeedVisibility;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Event type `notice` (Hinweis): creation rules, immutable type, list filter, bulk and untouched paths. */
class EventNoticeTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $user;
    private Club $club;
    private string $calId;
    private string $base;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $c = static::getContainer();
        self::$hasher = $c->get(UserPasswordHasherInterface::class);
        self::$tokens = $c->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
        ['user' => $this->user, 'club' => $this->club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $this->calId = $cal->getId();
        $this->base = "/api/calendars/{$this->calId}";
    }

    private function req(string $method, string $uri, array $body = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $body, TestHelper::authHeader($this->user, self::$tokens));
    }

    private function notice(array $extra = []): array
    {
        return $this->req('POST', "{$this->base}/events", $extra + ['type' => 'notice', 'name' => 'Ferien', 'date' => '2026-08-01']);
    }

    public function testCreateNotice(): void
    {
        $tg = TestHelper::createTargetGroup(self::$em, $this->club, 'Youth');
        $r = $this->notice(['dateEnd' => '2026-08-05', 'note' => 'Hinweis', 'targetGroupIds' => [$tg->getId()], 'isDraft' => false]);
        $this->assertSame(201, $r['status'], $r['content']);
        $b = $r['body'];
        $this->assertSame('notice', $b['type']);
        $this->assertTrue($b['isAllDay']);
        $this->assertSame('00:00', $b['timeBegin']);
        $this->assertSame('23:59', $b['timeEnd']);
        $this->assertSame('2026-08-05', $b['dateEnd']);
        $this->assertFalse($b['isDraft']);
        $this->assertCount(1, $b['targetGroups']);
    }

    public function testDefaultTypeIsEvent(): void
    {
        $r = $this->req('POST', "{$this->base}/events", ['name' => 'T', 'date' => '2026-08-01', 'timeBegin' => '18:00', 'timeEnd' => '19:00']);
        $this->assertSame(201, $r['status']);
        $this->assertSame('event', $r['body']['type']);
        $this->assertSame(422, $this->notice(['type' => 'bogus'])['status']);
    }

    public function testForbiddenFieldsAre422(): void
    {
        $loc = TestHelper::createLocation(self::$em, $this->club, 'Hall');
        $tmpl = TestHelper::createTemplate(self::$em, self::$em->getRepository(\App\Entity\Calendar::class)->find($this->calId));
        $prop = TestHelper::jsonRequest(self::$client, 'POST', "{$this->base}/properties", ['name' => 'P'], TestHelper::authHeader($this->user, self::$tokens))['body']['id'] ?? null;
        $feat = TestHelper::jsonRequest(self::$client, 'POST', "{$this->base}/features", ['name' => 'F'], TestHelper::authHeader($this->user, self::$tokens))['body']['id'] ?? null;
        $cases = [
            'locationId' => $loc->getId(),
            'eventTemplateId' => $tmpl->getId(),
            'propertyIds' => [$prop ?? 'x'],
            'featureIds' => [$feat ?? 'x'],
            'isAllDay' => false,
        ];
        foreach ($cases as $field => $value) {
            $r = $this->notice([$field => $value]);
            $this->assertSame(422, $r['status'], $field.$r['content']);
            $this->assertSame('validation_failed', $r['body']['code']);
            $this->assertSame($field, $r['body']['field']);
        }
    }

    public function testPatchCannotChangeTypeOrAddForbiddenFields(): void
    {
        $id = $this->notice()['body']['id'];
        $r = $this->req('PATCH', "{$this->base}/events/$id", ['type' => 'event', 'name' => 'Neu']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame('notice', $r['body']['type']);
        $this->assertSame('Neu', $r['body']['name']);
        $this->assertTrue($r['body']['isAllDay']);

        $loc = TestHelper::createLocation(self::$em, $this->club, 'Hall');
        $r = $this->req('PATCH', "{$this->base}/events/$id", ['locationId' => $loc->getId()]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('locationId', $r['body']['field']);

        $r = $this->req('PATCH', "{$this->base}/events/$id", ['timeBegin' => '10:00']);
        $this->assertSame('00:00', $r['body']['timeBegin']);

        $evt = $this->req('POST', "{$this->base}/events", ['name' => 'E', 'date' => '2026-08-01', 'timeBegin' => '18:00', 'timeEnd' => '19:00'])['body']['id'];
        $r = $this->req('PATCH', "{$this->base}/events/$evt", ['type' => 'notice']);
        $this->assertSame('event', $r['body']['type']);
    }

    public function testListFilter(): void
    {
        $n = $this->notice()['body']['id'];
        $e = $this->req('POST', "{$this->base}/events", ['name' => 'E', 'date' => '2026-08-01', 'timeBegin' => '18:00', 'timeEnd' => '19:00'])['body']['id'];

        $this->assertCount(2, $this->req('GET', "{$this->base}/events")['body']);
        $this->assertSame([$n], array_column($this->req('GET', "{$this->base}/events?type=notice")['body'], 'id'));
        $this->assertSame([$e], array_column($this->req('GET', "{$this->base}/events?type=event")['body'], 'id'));
        $r = $this->req('GET', "{$this->base}/events?type=foo");
        $this->assertSame(400, $r['status']);
        $this->assertSame('validation_failed', $r['body']['code']);
    }

    public function testBulkPublishDraftDeleteAndNoBadges(): void
    {
        $n = $this->notice()['body']['id'];
        $r = $this->req('POST', "{$this->base}/events/bulk", ['ids' => [$n], 'action' => 'publish']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertFalse($this->req('GET', "{$this->base}/events/$n")['body']['isDraft']);
        $this->req('POST', "{$this->base}/events/bulk", ['ids' => [$n], 'action' => 'draft']);
        $this->assertTrue($this->req('GET', "{$this->base}/events/$n")['body']['isDraft']);

        $prop = $this->req('POST', "{$this->base}/properties", ['name' => 'P'])['body']['id'];
        $r = $this->req('POST', "{$this->base}/events/bulk", ['ids' => [$n], 'action' => 'assign', 'propertyIds' => [$prop]]);
        $this->assertSame(422, $r['status']);

        $this->assertSame(200, $this->req('POST', "{$this->base}/events/bulk", ['ids' => [$n], 'action' => 'delete'])['status']);
    }

    public function testSeriesFromTemplateAndImportOnlyCreateEvents(): void
    {
        $cal = self::$em->getRepository(\App\Entity\Calendar::class)->find($this->calId);
        $tmpl = TestHelper::createTemplate(self::$em, $cal);
        $r = $this->req('POST', "{$this->base}/events/series", [
            'rule' => ['frequency' => 'weekly', 'weekday' => 4, 'startDate' => '2026-10-01', 'count' => 2],
            'event' => ['name' => 'S', 'timeBegin' => '19:00', 'timeEnd' => '21:00', 'type' => 'notice'],
        ]);
        $this->assertSame(201, $r['status'], $r['content']);
        foreach ($r['body']['events'] as $e) {
            $this->assertSame('event', $e['type']);
        }

        $r = $this->req('POST', "{$this->base}/events/from-template", ['templateId' => $tmpl->getId(), 'dates' => ['2026-11-01'], 'type' => 'notice']);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame('event', $r['body'][0]['type'] ?? $r['body']['events'][0]['type']);

        $r = $this->req('POST', "{$this->base}/events/import", ['events' => [['name' => 'I', 'date' => '2026-12-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00', 'type' => 'notice']]]);
        $this->assertSame(201, $r['status'], $r['content']);
        foreach ($this->req('GET', "{$this->base}/events")['body'] as $e) {
            $this->assertSame('event', $e['type']);
        }
    }

    public function testImportDuplicateCheckIgnoresNotices(): void
    {
        $this->notice(['name' => 'Same', 'date' => '2026-12-01']);
        $r = $this->req('POST', "{$this->base}/events/import/preview", ['events' => [['name' => 'Same', 'date' => '2026-12-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00']]]);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame('new', $r['body']['events'][0]['status'] ?? $r['body']['entries'][0]['status'] ?? null);
    }

    public function testPublicFeedDetailOfNoticeIs404(): void
    {
        $cal = self::$em->getRepository(\App\Entity\Calendar::class)->find($this->calId);
        $feed = TestHelper::createFeed(self::$em, $this->club, [$cal], FeedVisibility::PUBLIC);
        $n = $this->notice(['isDraft' => false])['body']['id'];
        $e = $this->req('POST', "{$this->base}/events", ['name' => 'E', 'date' => '2026-08-01', 'timeBegin' => '18:00', 'timeEnd' => '19:00', 'isDraft' => false])['body']['id'];

        self::$client->request('GET', "/api/feed/{$feed->getId()}/events/$n");
        $this->assertSame(404, self::$client->getResponse()->getStatusCode());
        self::$client->request('GET', "/api/feed/{$feed->getId()}/events/$e");
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
    }

    public function testNoticeNeverConflictsWithResource(): void
    {
        $loc = TestHelper::createLocation(self::$em, $this->club, 'Hall');
        $res = (new Resource())->setClub($this->club)->setName('Hall')->setLocation(self::$em->getRepository(Location::class)->find($loc->getId()));
        self::$em->persist($res);
        self::$em->flush();
        // A notice stored with the location (bypassing the API) must still be ignored by the checks
        $this->notice(['isDraft' => false, 'date' => '2026-07-01']);
        self::$em->createQuery('UPDATE App\Entity\Event e SET e.location = :l')->setParameter('l', $loc)->execute();

        $c = $this->req('POST', "{$this->base}/events/conflicts", ['date' => '2026-07-01', 'timeBegin' => '18:00', 'timeEnd' => '20:00', 'locationId' => $loc->getId(), 'isDraft' => false]);
        $this->assertSame([], $c['body']['conflicts']);
        $r = $this->req('POST', "{$this->base}/events", ['name' => 'E', 'date' => '2026-07-01', 'timeBegin' => '18:00', 'timeEnd' => '20:00', 'locationId' => $loc->getId(), 'isDraft' => false]);
        $this->assertSame(201, $r['status'], $r['content']);
        $cal = $this->req('GET', "/api/clubs/{$this->club->getId()}/resources/{$res->getId()}/events?from=2026-07-01&to=2026-07-01");
        $this->assertSame(200, $cal['status'], $cal['content']);
        $this->assertSame(['E'], array_column($cal['body'], 'name'));
    }
}
