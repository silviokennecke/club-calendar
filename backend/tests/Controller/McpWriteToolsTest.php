<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Event;
use App\Entity\EventTemplate;
use App\Entity\OAuthClient;
use App\Entity\User;
use App\Enum\ClubRole;
use App\OAuth\OAuthServerService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class McpWriteToolsTest extends WebTestCase
{
    private const string VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const string CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    private const string REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private UserPasswordHasherInterface $hasher;
    private string $clientId;
    private User $admin;
    private User $editor;
    private User $viewer;
    private User $outsider;
    private \App\Entity\Club $club;
    private Calendar $calendar;
    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        $this->hasher = $c->get(UserPasswordHasherInterface::class);
        DatabaseResetter::reset($this->em);
        $oauthClient = new OAuthClient('Claude', [self::REDIRECT], new \DateTimeImmutable());
        $this->em->persist($oauthClient);
        $this->em->flush();
        $this->clientId = $oauthClient->getId();

        $this->admin = TestHelper::createUser($this->em, $this->hasher, 'admin@example.com');
        $this->editor = TestHelper::createUser($this->em, $this->hasher, 'editor@example.com');
        $this->viewer = TestHelper::createUser($this->em, $this->hasher, 'viewer@example.com');
        $this->outsider = TestHelper::createUser($this->em, $this->hasher, 'outsider@example.com');
        $this->club = TestHelper::createClub($this->em, $this->admin, 'Mein Verein');
        TestHelper::addMember($this->em, $this->club, $this->editor, ClubRole::EDITOR);
        TestHelper::addMember($this->em, $this->club, $this->viewer, ClubRole::VIEWER);
        $this->calendar = TestHelper::createCalendar($this->em, $this->club, 'Hauptkalender');
    }

    private function token(User $user, string $scope = 'mcp:write'): string
    {
        $key = $user->getId().$scope;
        if (!isset($this->tokens[$key])) {
            $oauth = static::getContainer()->get(OAuthServerService::class);
            $client = $this->em->find(OAuthClient::class, $this->clientId);
            $request = $oauth->createAuthorizationRequest($client, self::REDIRECT, $scope, self::CHALLENGE, 'S256', 's', null);
            $code = $oauth->approve($request, $this->em->find(User::class, $user->getId()))['code'];
            $this->tokens[$key] = $oauth->exchangeCode($client, $code, self::REDIRECT, self::VERIFIER, null)['access_token'];
        }

        return $this->tokens[$key];
    }

    /** @return array{status: int, body: mixed, session: string} */
    private function rpc(array $message, string $token, ?string $session = null): array
    {
        $headers = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json, text/event-stream', 'HTTP_AUTHORIZATION' => 'Bearer '.$token];
        if (null !== $session) {
            $headers['HTTP_MCP_SESSION_ID'] = $session;
        }
        $this->client->request('POST', '/api/mcp', [], [], $headers, json_encode($message));
        $response = $this->client->getResponse();

        return ['status' => $response->getStatusCode(), 'body' => json_decode((string) $response->getContent(), true), 'session' => (string) $response->headers->get('Mcp-Session-Id')];
    }

    private function session(string $token): string
    {
        $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize', 'params' => [
            'protocolVersion' => '2025-06-18', 'capabilities' => new \stdClass(), 'clientInfo' => ['name' => 'test', 'version' => '1'],
        ]], $token);
        $this->rpc(['jsonrpc' => '2.0', 'method' => 'notifications/initialized'], $token, $r['session']);

        return $r['session'];
    }

    /**
     * @param array<string, mixed> $args
     *
     * @return array{error: bool, text: string, data: mixed}
     */
    private function call(User $user, string $tool, array $args = [], string $scope = 'mcp:write'): array
    {
        $token = $this->token($user, $scope);
        $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/call', 'params' => ['name' => $tool, 'arguments' => [] === $args ? new \stdClass() : $args]], $token, $this->session($token));
        $this->assertSame(200, $r['status']);
        $result = $r['body']['result'] ?? $this->fail(json_encode($r['body']));
        $text = $result['content'][0]['text'] ?? '';

        return ['error' => true === ($result['isError'] ?? false), 'text' => $text, 'data' => json_decode($text, true)];
    }

    private function ok(User $user, string $tool, array $args = []): mixed
    {
        $r = $this->call($user, $tool, $args);
        $this->assertFalse($r['error'], $r['text']);

        return $r['data'];
    }

    private function assertError(array $r, string $contains): void
    {
        $this->assertTrue($r['error'], $r['text']);
        $this->assertStringContainsString($contains, $r['text']);
    }

    private const READ = ['list_clubs', 'list_calendars', 'list_events', 'get_event', 'list_target_groups', 'list_properties', 'list_features', 'list_locations', 'list_event_templates', 'get_event_template', 'list_feeds', 'get_feed'];
    private const WRITE = ['create_event_draft', 'update_event_draft', 'create_target_group', 'create_location', 'create_property', 'create_feature', 'create_event_template', 'update_event_template', 'delete_event_template', 'create_feed'];

    /** @return array<string, array<string, mixed>> */
    private function writeCalls(): array
    {
        $cal = $this->calendar->getId();
        $club = $this->club->getId();
        $unknown = '00000000-0000-7000-8000-000000000000';

        return [
            'create_event_draft' => ['calendarId' => $cal, 'name' => 'X', 'date' => '2026-07-01', 'timeBegin' => '18:00', 'timeEnd' => '20:00'],
            'update_event_draft' => ['calendarId' => $cal, 'eventId' => $unknown, 'name' => 'Y'],
            'create_target_group' => ['clubId' => $club, 'name' => 'TG'],
            'create_location' => ['clubId' => $club, 'name' => 'Halle'],
            'create_property' => ['calendarId' => $cal, 'name' => 'P'],
            'create_feature' => ['calendarId' => $cal, 'name' => 'F'],
            'create_event_template' => ['calendarId' => $cal, 'name' => 'T'],
            'update_event_template' => ['calendarId' => $cal, 'templateId' => $unknown, 'name' => 'T2'],
            'delete_event_template' => ['calendarId' => $cal, 'templateId' => $unknown],
            'create_feed' => ['clubId' => $club, 'name' => 'Feed', 'calendarIds' => [$cal]],
        ];
    }

    public function testToolListIsExact(): void
    {
        $token = $this->token($this->admin);
        $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/list'], $token, $this->session($token));
        $names = array_column($r['body']['result']['tools'], 'name');
        $expected = [...self::READ, ...self::WRITE];
        sort($names);
        sort($expected);
        $this->assertSame($expected, $names);
        foreach ($r['body']['result']['tools'] as $tool) {
            $this->assertStringContainsString('untrusted', $tool['description'], $tool['name']);
            if ('delete_event_template' === $tool['name']) {
                $this->assertStringContainsString('IRREVERSIBLE', $tool['description']);
            }
            if (in_array($tool['name'], self::WRITE, true)) {
                $this->assertFalse($tool['annotations']['readOnlyHint'] ?? true, $tool['name']);
            }
        }
        $this->assertFalse(isset(array_column($r['body']['result']['tools'], null, 'name')['create_event_draft']['inputSchema']['properties']['isDraft']));
    }

    public function testReadOnlyTokenIsRefusedOnEveryWriteTool(): void
    {
        foreach ($this->writeCalls() as $tool => $args) {
            $r = $this->call($this->admin, $tool, $args, 'mcp:read');
            $this->assertError($r, 'mcp:write');
        }
        $this->assertSame(0, $this->em->getRepository(Event::class)->count([]));
    }

    public function testRoleMatrix(): void
    {
        $calls = $this->writeCalls();
        foreach ($calls as $tool => $args) {
            $this->assertError($this->call($this->viewer, $tool, $args), 'Forbidden');
            $this->assertError($this->call($this->outsider, $tool, $args), 'not found');
        }
        $this->assertSame([], $this->em->getRepository(Event::class)->findAll());
        // editors may write everything except feeds
        $this->assertError($this->call($this->editor, 'create_feed', $calls['create_feed']), 'Forbidden');
        foreach (['create_event_draft', 'create_target_group', 'create_location', 'create_property', 'create_feature', 'create_event_template'] as $tool) {
            $r = $this->call($this->editor, $tool, $calls[$tool]);
            $this->assertFalse($r['error'], $tool.': '.$r['text']);
        }
        $r = $this->call($this->admin, 'create_feed', $calls['create_feed']);
        $this->assertFalse($r['error'], $r['text']);
    }

    public function testDraftIsForcedAndReferencesAreLinked(): void
    {
        $cal = $this->calendar->getId();
        $tg = TestHelper::createTargetGroup($this->em, $this->club, 'Jugend');
        $loc = TestHelper::createLocation($this->em, $this->club, 'Halle');
        $prop = TestHelper::createProperty($this->em, $this->calendar, 'Tracht');
        $e = $this->ok($this->editor, 'create_event_draft', [
            'calendarId' => $cal, 'name' => 'Training', 'date' => '2026-07-01', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
            'isDraft' => false, 'locationId' => $loc->getId(), 'targetGroupIds' => [$tg->getId()], 'propertyIds' => [$prop->getId()], 'note' => 'Hallo',
        ]);
        $this->assertTrue($e['isDraft']);
        $this->assertSame($loc->getId(), $e['locationId']);
        $this->assertCount(1, $e['targetGroups']);
        $this->assertCount(1, $e['properties']);
        $this->assertNull($e['seriesId']);

        $allDay = $this->ok($this->editor, 'create_event_draft', ['calendarId' => $cal, 'name' => 'Fest', 'date' => '2026-07-02', 'isAllDay' => true]);
        $this->assertTrue($allDay['isDraft']);
        $this->assertSame('23:59', $allDay['timeEnd']);

        $this->assertError($this->call($this->editor, 'create_event_draft', ['calendarId' => $cal, 'name' => 'Bad', 'date' => '2026-07-01', 'timeBegin' => '18:00', 'timeEnd' => '20:00', 'locationId' => '00000000-0000-7000-8000-000000000000']), 'unknown_reference');
    }

    public function testUpdateDraftOnlyForDrafts(): void
    {
        $cal = $this->calendar->getId();
        $draft = TestHelper::createEvent($this->em, $this->calendar, ['name' => 'Entwurf', 'isDraft' => true]);
        $pub = TestHelper::createEvent($this->em, $this->calendar, ['name' => 'Fest', 'isDraft' => false]);

        $u = $this->ok($this->editor, 'update_event_draft', ['calendarId' => $cal, 'eventId' => $draft->getId(), 'name' => 'Neu', 'note' => 'n', 'isDraft' => false, 'scope' => 'all']);
        $this->assertSame('Neu', $u['name']);
        $this->assertSame('n', $u['note']);
        $this->assertTrue($u['isDraft']);
        $this->assertSame('18:00', $u['timeBegin']);

        $r = $this->call($this->editor, 'update_event_draft', ['calendarId' => $cal, 'eventId' => $pub->getId(), 'name' => 'Hack']);
        $this->assertError($r, 'event_not_draft');
        $this->em->clear();
        $fresh = $this->em->find(Event::class, $pub->getId());
        $this->assertSame('Fest', $fresh->getName());
        $this->assertFalse($fresh->isDraft());

        $this->assertError($this->call($this->editor, 'update_event_draft', ['calendarId' => $cal, 'eventId' => '00000000-0000-7000-8000-000000000000', 'name' => 'x']), 'not found');
    }

    public function testScopeAllIsIgnoredForSeriesEvents(): void
    {
        $cal = $this->calendar->getId();
        $series = new \App\Entity\EventSeries($this->calendar, \App\Service\SeriesRule::fromInput(['frequency' => 'weekly', 'weekday' => 3, 'startDate' => '2026-07-01', 'count' => 2]));
        $this->em->persist($series);
        $a = TestHelper::createEvent($this->em, $this->calendar, ['name' => 'Reihe', 'date' => '2026-07-01']);
        $b = TestHelper::createEvent($this->em, $this->calendar, ['name' => 'Reihe', 'date' => '2026-07-08']);
        $a->setSeries($series);
        $b->setSeries($series);
        $this->em->flush();
        $seriesId = $series->getId();

        $this->ok($this->editor, 'update_event_draft', ['calendarId' => $cal, 'eventId' => $a->getId(), 'name' => 'Nur eins', 'scope' => 'all']);
        $this->em->clear();
        $this->assertSame('Reihe', $this->em->find(Event::class, $b->getId())->getName());
        $this->assertSame($seriesId, $this->em->find(Event::class, $a->getId())->getSeries()?->getId());
    }

    public function testArchivedCalendarIsRefused(): void
    {
        $draft = TestHelper::createEvent($this->em, $this->calendar, ['isDraft' => true]);
        $template = TestHelper::createTemplate($this->em, $this->calendar, ['name' => 'T']);
        $this->calendar->setArchivedAt(new \DateTimeImmutable());
        $this->em->flush();
        $cal = $this->calendar->getId();
        $calls = [
            'create_event_draft' => ['calendarId' => $cal, 'name' => 'X', 'date' => '2026-07-01', 'timeBegin' => '18:00', 'timeEnd' => '20:00'],
            'update_event_draft' => ['calendarId' => $cal, 'eventId' => $draft->getId(), 'name' => 'Y'],
            'create_property' => ['calendarId' => $cal, 'name' => 'P'],
            'create_feature' => ['calendarId' => $cal, 'name' => 'F'],
            'create_event_template' => ['calendarId' => $cal, 'name' => 'T2'],
            'update_event_template' => ['calendarId' => $cal, 'templateId' => $template->getId(), 'name' => 'T3'],
            'delete_event_template' => ['calendarId' => $cal, 'templateId' => $template->getId()],
        ];
        foreach ($calls as $tool => $args) {
            $this->assertError($this->call($this->admin, $tool, $args), 'archived');
        }
        $this->assertNotNull($this->em->getRepository(EventTemplate::class)->find($template->getId()));
    }

    public function testQuotaSurfacesCode(): void
    {
        for ($i = 0; $i < 50; ++$i) {
            TestHelper::createFeed($this->em, $this->club, [$this->calendar], \App\Enum\FeedVisibility::CLUB, 'F'.$i);
        }
        $r = $this->call($this->admin, 'create_feed', ['clubId' => $this->club->getId(), 'name' => 'Zu viel', 'calendarIds' => [$this->calendar->getId()]]);
        $this->assertError($r, 'quota_exceeded');
    }

    public function testFeedVisibility(): void
    {
        $club = $this->club->getId();
        $cal = [$this->calendar->getId()];
        foreach (['PUBLIC', 'public', 'SECRET', ''] as $v) {
            $this->assertError($this->call($this->admin, 'create_feed', ['clubId' => $club, 'name' => 'F', 'calendarIds' => $cal, 'visibility' => $v]), 'visibility');
        }
        $default = $this->ok($this->admin, 'create_feed', ['clubId' => $club, 'name' => 'Standard', 'calendarIds' => $cal]);
        $this->assertSame('CLUB', $default['visibility']);
        $this->assertNotSame('', $default['sharedSecret']);
        $this->assertStringEndsWith('/ics', $default['icsPath']);
        $private = $this->ok($this->admin, 'create_feed', ['clubId' => $club, 'name' => 'Privat', 'calendarIds' => $cal, 'visibility' => 'PRIVATE']);
        $this->assertSame('PRIVATE', $private['visibility']);
        $this->assertStringContainsString('?secret='.$private['sharedSecret'], $private['icsPath']);
        $this->assertError($this->call($this->admin, 'create_feed', ['clubId' => $club, 'name' => 'F', 'calendarIds' => []]), 'calendarIds');
    }

    public function testReferenceDataAndTemplateCrud(): void
    {
        $cal = $this->calendar->getId();
        $club = $this->club->getId();
        $this->assertSame('Jugend', $this->ok($this->editor, 'create_target_group', ['clubId' => $club, 'name' => 'Jugend'])['name']);
        $this->assertError($this->call($this->editor, 'create_target_group', ['clubId' => $club, 'name' => 'Jugend']), 'duplicate_name');
        $this->assertSame('Halle', $this->ok($this->editor, 'create_location', ['clubId' => $club, 'name' => 'Halle', 'latitude' => 52.5, 'longitude' => 13.4])['name']);
        $this->assertSame('P', $this->ok($this->editor, 'create_property', ['calendarId' => $cal, 'name' => 'P', 'icon' => 'x'])['name']);
        $this->assertSame('F', $this->ok($this->editor, 'create_feature', ['calendarId' => $cal, 'name' => 'F'])['name']);

        $t = $this->ok($this->editor, 'create_event_template', ['calendarId' => $cal, 'name' => 'Training', 'timeBegin' => '18:00', 'timeEnd' => '20:00', 'note' => 'a']);
        $this->assertSame('Training', $t['name']);
        $u = $this->ok($this->editor, 'update_event_template', ['calendarId' => $cal, 'templateId' => $t['id'], 'name' => 'Training 2', 'note' => '']);
        $this->assertSame('Training 2', $u['name']);
        $this->assertNull($u['note']);
        $this->assertSame('18:00', $u['timeBegin']);
        $this->assertError($this->call($this->editor, 'update_event_template', ['calendarId' => $cal, 'templateId' => $t['id'], 'timeEnd' => '']), 'timeEnd');
        $this->assertSame(['ok' => true], $this->ok($this->editor, 'delete_event_template', ['calendarId' => $cal, 'templateId' => $t['id']]));
        $this->assertError($this->call($this->editor, 'get_event_template', ['calendarId' => $cal, 'templateId' => $t['id']]), 'not found');
    }

    public function testForbiddenToolsDoNotExist(): void
    {
        $token = $this->token($this->admin);
        $session = $this->session($token);
        foreach (['delete_event', 'delete_target_group', 'delete_property', 'delete_feature', 'delete_location', 'delete_feed', 'publish_event', 'update_target_group', 'update_property', 'update_feature', 'update_location', 'update_feed', 'import_events', 'bulk_events', 'create_event_series'] as $name) {
            $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 3, 'method' => 'tools/call', 'params' => ['name' => $name, 'arguments' => new \stdClass()]], $token, $session);
            $this->assertTrue(isset($r['body']['error']) || true === ($r['body']['result']['isError'] ?? false), $name);
        }
    }
}
