<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarMember;
use App\Entity\Club;
use App\Entity\Event;
use App\Entity\EventTemplate;
use App\Entity\Feature;
use App\Entity\Location;
use App\Entity\OAuthClient;
use App\Entity\Property;
use App\Entity\TargetGroup;
use App\Entity\User;
use App\Enum\ClubRole;
use App\OAuth\OAuthServerService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Mcp\Capability\Attribute\McpTool;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Uid\Uuid;

/**
 * MCP access of plain club members who hold a CalendarMember row: only their calendars, decided per call by the
 * same voters as the REST API (no elevation through the token, ids of other calendars/clubs, drafts, resources).
 */
class McpCalendarMemberTest extends WebTestCase
{
    private const string VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const string CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    private const string REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

    private const string NOT_CAL = 'Calendar not found.';
    private const string NOT_CLUB = 'Club not found.';
    private const string FORBIDDEN = 'Forbidden';

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private UserPasswordHasherInterface $hasher;
    private string $clientId;

    /** @var array<string, User> */
    private array $u = [];
    private Club $club;
    private Club $club2;
    private Calendar $calA;
    private Calendar $calB;
    private Calendar $cal2;
    private Event $draftA;
    private Event $pubA;
    private Event $draftB;
    private Event $pubB;
    private EventTemplate $tplA;
    private EventTemplate $tplB;
    private Property $propA;
    private Property $propB;
    private Property $prop2;
    private Feature $featB;
    private Location $loc;
    private Location $loc2;
    private TargetGroup $tg;
    private TargetGroup $tg2;
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

        foreach (['admin', 'editor', 'viewer', 'viewerRow', 'noRow', 'row', 'other', 'outsider'] as $name) {
            $this->u[$name] = TestHelper::createUser($this->em, $this->hasher, $name.'@example.com');
        }
        $this->club = TestHelper::createClub($this->em, $this->u['admin'], 'Verein');
        $this->club2 = TestHelper::createClub($this->em, $this->u['other'], 'Anderer Verein');
        TestHelper::addMember($this->em, $this->club, $this->u['editor'], ClubRole::EDITOR);
        TestHelper::addMember($this->em, $this->club, $this->u['viewer'], ClubRole::VIEWER);
        TestHelper::addMember($this->em, $this->club, $this->u['viewerRow'], ClubRole::VIEWER);
        TestHelper::addMember($this->em, $this->club, $this->u['noRow'], ClubRole::MEMBER);
        TestHelper::addMember($this->em, $this->club, $this->u['row'], ClubRole::MEMBER);

        $this->calA = TestHelper::createCalendar($this->em, $this->club, 'A');
        $this->calB = TestHelper::createCalendar($this->em, $this->club, 'B');
        $this->cal2 = TestHelper::createCalendar($this->em, $this->club2, 'Fremd');
        foreach (['row', 'viewerRow'] as $name) {
            $this->em->persist(new CalendarMember($this->calA, $this->u[$name], $this->u['admin']));
        }
        $this->em->flush();

        $this->draftA = TestHelper::createEvent($this->em, $this->calA, ['name' => 'Entwurf A', 'isDraft' => true]);
        $this->pubA = TestHelper::createEvent($this->em, $this->calA, ['name' => 'Fest A', 'isDraft' => false, 'date' => '2026-07-02']);
        $this->draftB = TestHelper::createEvent($this->em, $this->calB, ['name' => 'Entwurf B', 'isDraft' => true]);
        $this->pubB = TestHelper::createEvent($this->em, $this->calB, ['name' => 'Fest B', 'isDraft' => false, 'date' => '2026-07-03']);
        $this->tplA = TestHelper::createTemplate($this->em, $this->calA, ['name' => 'Vorlage A']);
        $this->tplB = TestHelper::createTemplate($this->em, $this->calB, ['name' => 'Vorlage B']);
        $this->propA = TestHelper::createProperty($this->em, $this->calA, 'Tracht A');
        $this->propB = TestHelper::createProperty($this->em, $this->calB, 'Tracht B');
        $this->prop2 = TestHelper::createProperty($this->em, $this->cal2, 'Tracht Fremd');
        TestHelper::createFeature($this->em, $this->calA, 'Bonus A');
        $this->featB = TestHelper::createFeature($this->em, $this->calB, 'Bonus B');
        $this->loc = TestHelper::createLocation($this->em, $this->club, 'Halle');
        $this->loc2 = TestHelper::createLocation($this->em, $this->club2, 'Fremdhalle');
        $this->tg = TestHelper::createTargetGroup($this->em, $this->club, 'Jugend');
        $this->tg2 = TestHelper::createTargetGroup($this->em, $this->club2, 'Fremdgruppe');
    }

    private function token(User $user): string
    {
        $key = $user->getId();
        if (!isset($this->tokens[$key])) {
            $oauth = static::getContainer()->get(OAuthServerService::class);
            $client = $this->em->find(OAuthClient::class, $this->clientId);
            $request = $oauth->createAuthorizationRequest($client, self::REDIRECT, 'mcp:write', self::CHALLENGE, 'S256', 's', null);
            $code = $oauth->approve($request, $this->em->find(User::class, $key))['code'];
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

    /** @return array{error: bool, text: string, data: mixed} */
    private function call(string $who, string $tool, array $args = []): array
    {
        $token = $this->token($this->u[$who]);
        $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/call', 'params' => ['name' => $tool, 'arguments' => [] === $args ? new \stdClass() : $args]], $token, $this->session($token));
        $this->assertSame(200, $r['status']);
        $result = $r['body']['result'] ?? $this->fail(json_encode($r['body']));
        $text = $result['content'][0]['text'] ?? '';

        return ['error' => true === ($result['isError'] ?? false), 'text' => $text, 'data' => json_decode($text, true)];
    }

    private function ok(string $who, string $tool, array $args = []): mixed
    {
        $r = $this->call($who, $tool, $args);
        $this->assertFalse($r['error'], $who.' '.$tool.': '.$r['text']);

        return $r['data'];
    }

    private function denied(string $who, string $tool, array $args, string $contains): void
    {
        $r = $this->call($who, $tool, $args);
        $this->assertTrue($r['error'], $who.' '.$tool.' should be denied: '.$r['text']);
        $this->assertStringContainsString($contains, $r['text'], $who.' '.$tool);
    }

    /**
     * Calendar-scoped tools: mode `read` (viewer or a row) or `write` (editor or a row). Arguments for calendar $cal
     * ('A' or 'B'); `B` objects belong to the same club but another calendar.
     *
     * @return array<string, array{mode: string, args: callable(string): array<string, mixed>}>
     */
    private function calendarMatrix(): array
    {
        $calId = fn (string $c): string => 'A' === $c ? $this->calA->getId() : $this->calB->getId();
        $ev = fn (string $c): string => 'A' === $c ? $this->draftA->getId() : $this->draftB->getId();
        $pub = fn (string $c): string => 'A' === $c ? $this->pubA->getId() : $this->pubB->getId();
        $tpl = fn (string $c): string => 'A' === $c ? $this->tplA->getId() : $this->tplB->getId();

        return [
            'list_events' => ['mode' => 'read', 'args' => fn ($c) => ['calendarId' => $calId($c)]],
            'get_event' => ['mode' => 'read', 'args' => fn ($c) => ['calendarId' => $calId($c), 'eventId' => $pub($c)]],
            'list_properties' => ['mode' => 'read', 'args' => fn ($c) => ['calendarId' => $calId($c)]],
            'list_features' => ['mode' => 'read', 'args' => fn ($c) => ['calendarId' => $calId($c)]],
            'list_event_templates' => ['mode' => 'read', 'args' => fn ($c) => ['calendarId' => $calId($c)]],
            'get_event_template' => ['mode' => 'read', 'args' => fn ($c) => ['calendarId' => $calId($c), 'templateId' => $tpl($c)]],
            'create_event_draft' => ['mode' => 'write', 'args' => fn ($c) => ['calendarId' => $calId($c), 'name' => 'Neu', 'date' => '2026-08-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00']],
            'update_event_draft' => ['mode' => 'write', 'args' => fn ($c) => ['calendarId' => $calId($c), 'eventId' => $ev($c), 'name' => 'Geändert']],
            'unpublish_event' => ['mode' => 'write', 'args' => fn ($c) => ['calendarId' => $calId($c), 'eventId' => $pub($c)]],
            'create_property' => ['mode' => 'write', 'args' => fn ($c) => ['calendarId' => $calId($c), 'name' => 'P '.$c.uniqid()]],
            'create_feature' => ['mode' => 'write', 'args' => fn ($c) => ['calendarId' => $calId($c), 'name' => 'F '.$c.uniqid()]],
            'create_event_template' => ['mode' => 'write', 'args' => fn ($c) => ['calendarId' => $calId($c), 'name' => 'T '.$c.uniqid()]],
            'update_event_template' => ['mode' => 'write', 'args' => fn ($c) => ['calendarId' => $calId($c), 'templateId' => $tpl($c), 'name' => 'Umbenannt']],
            'delete_event_template' => ['mode' => 'write', 'args' => fn ($c) => ['calendarId' => $calId($c), 'templateId' => $tpl($c)]],
            'check_event_conflicts' => ['mode' => 'write', 'args' => fn ($c) => ['calendarId' => $calId($c), 'locationId' => $this->loc->getId(), 'date' => '2026-07-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00']],
        ];
    }

    /**
     * Club-scoped tools. `plain`: what a plain member WITH a row gets ('ok' or 'denied'); `min`: lowest real club role.
     *
     * @return array<string, array{plain: string, min: ClubRole, args: array<string, mixed>}>
     */
    private function clubMatrix(): array
    {
        $club = $this->club->getId();
        $unknown = Uuid::v7()->toRfc4122();

        return [
            'list_clubs' => ['plain' => 'ok', 'min' => ClubRole::VIEWER, 'args' => []],
            'list_calendars' => ['plain' => 'ok', 'min' => ClubRole::VIEWER, 'args' => ['clubId' => $club]],
            'list_locations' => ['plain' => 'ok', 'min' => ClubRole::VIEWER, 'args' => ['clubId' => $club]],
            'list_target_groups' => ['plain' => 'ok', 'min' => ClubRole::VIEWER, 'args' => ['clubId' => $club]],
            'create_location' => ['plain' => 'denied', 'min' => ClubRole::EDITOR, 'args' => ['clubId' => $club, 'name' => 'Neu']],
            'create_target_group' => ['plain' => 'denied', 'min' => ClubRole::EDITOR, 'args' => ['clubId' => $club, 'name' => 'Neu']],
            'list_feeds' => ['plain' => 'denied', 'min' => ClubRole::EDITOR, 'args' => ['clubId' => $club]],
            'get_feed' => ['plain' => 'denied', 'min' => ClubRole::EDITOR, 'args' => ['clubId' => $club, 'feedId' => $unknown]],
            'create_feed' => ['plain' => 'denied', 'min' => ClubRole::ADMIN, 'args' => ['clubId' => $club, 'name' => 'Feed', 'calendarIds' => [$this->calA->getId()]]],
            'list_resources' => ['plain' => 'denied', 'min' => ClubRole::VIEWER, 'args' => ['clubId' => $club]],
            'list_resource_events' => ['plain' => 'denied', 'min' => ClubRole::VIEWER, 'args' => ['clubId' => $club, 'resourceId' => $unknown, 'from' => '2026-07-01', 'to' => '2026-07-31']],
        ];
    }

    public function testMatrixCoversEveryRegisteredTool(): void
    {
        $registered = [];
        foreach (glob(dirname(__DIR__, 2).'/src/Mcp/Tool/*Tool.php') as $file) {
            $class = 'App\\Mcp\\Tool\\'.basename($file, '.php');
            $registered[] = (new \ReflectionClass($class))->getAttributes(McpTool::class)[0]->newInstance()->name;
        }
        $covered = array_merge(array_keys($this->calendarMatrix()), array_keys($this->clubMatrix()));
        sort($registered);
        sort($covered);
        $this->assertSame($registered, $covered, 'every MCP tool needs an entry in the calendar-member matrix');
        $this->assertCount(count($covered), array_unique($covered));
    }

    public function testCalendarToolsMatrix(): void
    {
        foreach ($this->calendarMatrix() as $tool => $spec) {
            foreach (['noRow', 'other', 'outsider'] as $who) {
                foreach (['A', 'B'] as $cal) {
                    $this->denied($who, $tool, ($spec['args'])($cal), self::NOT_CAL);
                }
            }
            // Plain member with a row: calendar A allowed, calendar B is "not found" like for an outsider
            $this->denied('row', $tool, ($spec['args'])('B'), self::NOT_CAL);
        }
    }

    public function testRowGrantsAccessOnlyToTheOwnCalendar(): void
    {
        foreach ($this->calendarMatrix() as $tool => $spec) {
            if ('delete_event_template' === $tool) {
                continue;
            }
            $this->ok('row', $tool, ($spec['args'])('A'));
            $this->ok('viewerRow', $tool, ($spec['args'])('A'));
            $this->ok('editor', $tool, ($spec['args'])('A'));
            $this->ok('editor', $tool, ($spec['args'])('B'));
            $this->ok('admin', $tool, ($spec['args'])('B'));
            if ('read' === $spec['mode']) {
                $this->ok('viewer', $tool, ($spec['args'])('B'));
                $this->ok('viewerRow', $tool, ($spec['args'])('B'));
            } else {
                $this->denied('viewerRow', $tool, ($spec['args'])('B'), self::FORBIDDEN);
            }
        }
        $this->ok('row', 'delete_event_template', ['calendarId' => $this->calA->getId(), 'templateId' => $this->tplA->getId()]);
        $this->assertNull($this->em->getRepository(EventTemplate::class)->find($this->tplA->getId()));
    }

    public function testViewerWithoutRowCannotWrite(): void
    {
        foreach ($this->calendarMatrix() as $tool => $spec) {
            if ('write' === $spec['mode']) {
                $this->denied('viewer', $tool, ($spec['args'])('A'), self::FORBIDDEN);
            } else {
                $this->ok('viewer', $tool, ($spec['args'])('A'));
            }
        }
    }

    public function testClubToolsMatrix(): void
    {
        foreach ($this->clubMatrix() as $tool => $spec) {
            if ('list_clubs' === $tool) {
                continue;
            }
            $args = $spec['args'];
            $this->denied('outsider', $tool, $args, self::NOT_CLUB);
            $this->denied('other', $tool, $args, self::NOT_CLUB);
            if ('ok' === $spec['plain']) {
                $this->ok('row', $tool, $args);
                $this->ok('viewerRow', $tool, $args);
                $this->denied('noRow', $tool, $args, self::FORBIDDEN);
            } else {
                $this->denied('row', $tool, $args, self::FORBIDDEN);
                $this->denied('noRow', $tool, $args, self::FORBIDDEN);
                if (ClubRole::VIEWER === $spec['min']) {
                    // a viewer-level club tool: staff pass the access check, a row never widens it
                    $this->assertStringNotContainsString(self::FORBIDDEN, $this->call('viewerRow', $tool, $args)['text'], $tool);
                } else {
                    $this->denied('viewerRow', $tool, $args, self::FORBIDDEN);
                    $this->denied('viewer', $tool, $args, self::FORBIDDEN);
                }
            }
            $real = ClubRole::ADMIN === $spec['min'] ? 'admin' : 'editor';
            $text = $this->call($real, $tool, $args)['text'];
            $this->assertStringNotContainsString(self::FORBIDDEN, $text, $tool);
            $this->assertStringNotContainsString(self::NOT_CLUB, $text, $tool);
        }
    }

    public function testListClubsShowsMemberClubOnlyWithAccessibleCalendars(): void
    {
        $this->assertSame([], $this->ok('noRow', 'list_clubs'));
        $this->assertSame([], $this->ok('outsider', 'list_clubs'));

        $clubs = $this->ok('row', 'list_clubs');
        $this->assertCount(1, $clubs);
        $this->assertSame($this->club->getId(), $clubs[0]['id']);
        $this->assertSame('member', $clubs[0]['role']);
        $this->assertSame([$this->calA->getId()], array_column($clubs[0]['calendars'], 'id'));
        $this->assertArrayNotHasKey('memberCount', $clubs[0]);

        $this->assertSame('viewer', $this->ok('viewerRow', 'list_clubs')[0]['role']);
        $this->assertSame($this->club2->getId(), $this->ok('other', 'list_clubs')[0]['id']);
    }

    public function testListCalendarsShowsOnlyOwnCalendars(): void
    {
        $args = ['clubId' => $this->club->getId()];
        $this->assertSame([$this->calA->getId()], array_column($this->ok('row', 'list_calendars', $args), 'id'));
        $this->assertCount(2, $this->ok('viewerRow', 'list_calendars', $args));
        $this->assertCount(2, $this->ok('editor', 'list_calendars', $args));
    }

    public function testDraftsAreVisibleToRowMemberOnlyOnTheirCalendar(): void
    {
        $list = $this->ok('row', 'list_events', ['calendarId' => $this->calA->getId()]);
        $this->assertSame(2, $list['total']);
        $this->assertSame('Entwurf A', $this->ok('row', 'get_event', ['calendarId' => $this->calA->getId(), 'eventId' => $this->draftA->getId()])['name']);
        // viewer without a row: published only
        $this->assertSame(1, $this->ok('viewer', 'list_events', ['calendarId' => $this->calA->getId()])['total']);
        $this->denied('row', 'get_event', ['calendarId' => $this->calB->getId(), 'eventId' => $this->draftB->getId()], self::NOT_CAL);
        // an event of calendar B is not reachable through calendar A
        $this->denied('row', 'get_event', ['calendarId' => $this->calA->getId(), 'eventId' => $this->draftB->getId()], 'not found');
    }

    public function testRowMemberCannotEditPublishedEventsOrMoveEvents(): void
    {
        $a = $this->calA->getId();
        $this->denied('row', 'update_event_draft', ['calendarId' => $a, 'eventId' => $this->pubA->getId(), 'name' => 'X'], 'event_not_draft');
        $this->denied('row', 'update_event_draft', ['calendarId' => $a, 'eventId' => $this->draftB->getId(), 'name' => 'X'], 'not found');
        $this->em->clear();
        $this->assertSame('Entwurf B', $this->em->find(Event::class, $this->draftB->getId())->getName());
        $created = $this->ok('row', 'create_event_draft', ['calendarId' => $a, 'name' => 'Neu', 'date' => '2026-08-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00']);
        $this->assertTrue($created['isDraft']);
        $this->assertSame($a, $created['calendarId']);
    }

    public function testForeignReferencesAreRejected(): void
    {
        $a = $this->calA->getId();
        $base = ['calendarId' => $a, 'name' => 'X', 'date' => '2026-08-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00'];
        // another club
        $this->denied('row', 'create_event_draft', $base + ['locationId' => $this->loc2->getId()], 'unknown_reference');
        $this->denied('row', 'create_event_draft', $base + ['targetGroupIds' => [$this->tg2->getId()]], 'unknown_reference');
        $this->denied('row', 'create_event_draft', $base + ['propertyIds' => [$this->prop2->getId()]], 'unknown_reference');
        // same club, other calendar
        $this->denied('row', 'create_event_draft', $base + ['propertyIds' => [$this->propB->getId()]], 'unknown_reference');
        $this->denied('row', 'create_event_draft', $base + ['featureIds' => [$this->featB->getId()]], 'unknown_reference');
        $this->denied('row', 'create_event_draft', $base + ['eventTemplateId' => $this->tplB->getId()], 'unknown_reference');
        $this->denied('row', 'update_event_draft', ['calendarId' => $a, 'eventId' => $this->draftA->getId(), 'propertyIds' => [$this->propB->getId()]], 'unknown_reference');
        $this->denied('row', 'update_event_draft', ['calendarId' => $a, 'eventId' => $this->draftA->getId(), 'locationId' => $this->loc2->getId()], 'unknown_reference');
        // templates: no club-level creation, references limited the same way
        $this->denied('row', 'create_event_template', ['calendarId' => $a, 'name' => 'T', 'locationId' => $this->loc2->getId()], 'unknown_reference');
        $this->denied('row', 'create_event_template', ['calendarId' => $a, 'name' => 'T', 'targetGroupIds' => [$this->tg2->getId()]], 'unknown_reference');
        $this->denied('row', 'create_event_template', ['calendarId' => $a, 'name' => 'T', 'propertyIds' => [$this->propB->getId()]], 'unknown_reference');
        $this->denied('row', 'update_event_template', ['calendarId' => $a, 'templateId' => $this->tplA->getId(), 'featureIds' => [$this->featB->getId()]], 'unknown_reference');
        // templates of another calendar through this calendar
        foreach (['get_event_template', 'update_event_template', 'delete_event_template'] as $tool) {
            $this->denied('row', $tool, ['calendarId' => $a, 'templateId' => $this->tplB->getId(), 'name' => 'Y'], 'not found');
        }
        $this->em->clear();
        $this->assertNotNull($this->em->find(EventTemplate::class, $this->tplB->getId()));
        $this->assertSame('Vorlage B', $this->em->find(EventTemplate::class, $this->tplB->getId())->getName());
        // own club references work
        $ok = $this->ok('row', 'create_event_draft', $base + ['locationId' => $this->loc->getId(), 'targetGroupIds' => [$this->tg->getId()], 'propertyIds' => [$this->propA->getId()]]);
        $this->assertSame($this->loc->getId(), $ok['locationId']);
    }

    public function testPlainMemberWithRowCanUseNotices(): void
    {
        $a = $this->calA->getId();
        $n = $this->ok('row', 'create_event_draft', ['calendarId' => $a, 'type' => 'notice', 'name' => 'Ferien', 'date' => '2026-08-01']);
        $this->assertSame('notice', $n['type']);
        $this->ok('row', 'update_event_draft', ['calendarId' => $a, 'eventId' => $n['id'], 'name' => 'Sommerferien']);
        $rows = $this->ok('row', 'list_events', ['calendarId' => $a, 'type' => 'notice']);
        $this->assertSame('notice', $rows['items'][0]['type']);
    }

    public function testWritesToArchivedCalendarAreRefused(): void
    {
        $this->calA->setArchivedAt(new \DateTimeImmutable());
        $this->em->flush();
        $this->denied('row', 'create_event_draft', ['calendarId' => $this->calA->getId(), 'name' => 'X', 'date' => '2026-08-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00'], 'archived');
        $this->ok('row', 'list_events', ['calendarId' => $this->calA->getId()]);
    }

    public function testConflictDetailsAreHiddenFromCalendarMembers(): void
    {
        $res = (new \App\Entity\Resource())->setClub($this->club)->setName('Halle')->setLocation($this->loc);
        $this->em->persist($res);
        $this->em->flush();
        $other = TestHelper::createEvent($this->em, $this->calB, ['name' => 'Geheim', 'isDraft' => false]);
        $other->setLocation($this->loc);
        $this->em->flush();
        $args = ['calendarId' => $this->calA->getId(), 'locationId' => $this->loc->getId(), 'date' => '2026-07-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00'];

        $member = $this->ok('row', 'check_event_conflicts', $args + ['isDraft' => false]);
        $this->assertTrue($member['blocking']);
        $this->assertStringNotContainsString('Geheim', json_encode($member));
        $this->assertStringNotContainsString($other->getId(), json_encode($member));

        $staff = $this->ok('editor', 'check_event_conflicts', $args);
        $this->assertSame('Geheim', $staff['conflicts'][0]['eventName']);
        // viewer with a row is staff by club role (as in REST)
        $this->assertSame('Geheim', $this->ok('viewerRow', 'check_event_conflicts', $args)['conflicts'][0]['eventName']);
    }

    public function testRemovingTheRowEndsAccessImmediatelyWithTheSameToken(): void
    {
        $a = $this->calA->getId();
        $this->ok('row', 'list_events', ['calendarId' => $a]);
        $this->ok('row', 'create_event_draft', ['calendarId' => $a, 'name' => 'Vorher', 'date' => '2026-08-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00']);
        $this->assertCount(1, $this->ok('row', 'list_clubs'));

        $this->em->createQuery('DELETE FROM '.CalendarMember::class.' m WHERE m.user = :u')->setParameter('u', $this->u['row'])->execute();

        foreach ($this->calendarMatrix() as $tool => $spec) {
            $this->denied('row', $tool, ($spec['args'])('A'), self::NOT_CAL);
        }
        $this->denied('row', 'list_locations', ['clubId' => $this->club->getId()], self::FORBIDDEN);
        $this->denied('row', 'list_calendars', ['clubId' => $this->club->getId()], self::FORBIDDEN);
        $this->assertSame([], $this->ok('row', 'list_clubs'));
    }

    public function testLeavingTheClubEndsAccess(): void
    {
        $a = $this->calA->getId();
        $this->ok('row', 'list_events', ['calendarId' => $a]);
        // Raw removal of the club membership, leaving a stale row behind: the voters still deny
        $this->em->getConnection()->executeStatement('DELETE FROM club_user WHERE user_id = ?', [$this->u['row']->getId()]);
        $this->denied('row', 'list_events', ['calendarId' => $a], self::NOT_CAL);
        $this->denied('row', 'create_event_draft', ['calendarId' => $a, 'name' => 'X', 'date' => '2026-08-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00'], self::NOT_CAL);
        $this->denied('row', 'list_locations', ['clubId' => $this->club->getId()], self::NOT_CLUB);
        $this->assertSame([], $this->ok('row', 'list_clubs'));
    }

    public function testRoleChangeTakesEffectMidGrant(): void
    {
        $a = $this->calA->getId();
        $this->denied('viewer', 'create_event_draft', ['calendarId' => $a, 'name' => 'X', 'date' => '2026-08-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00'], self::FORBIDDEN);
        $membership = $this->em->getRepository(\App\Entity\ClubUser::class)->findOneBy(['club' => $this->club, 'user' => $this->u['viewer']]);
        $membership->setRole(ClubRole::EDITOR);
        $this->em->flush();
        $this->ok('viewer', 'create_event_draft', ['calendarId' => $a, 'name' => 'X', 'date' => '2026-08-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00']);
    }

    public function testMemberOfAnotherClubSeesNothing(): void
    {
        foreach ($this->calendarMatrix() as $tool => $spec) {
            $this->denied('other', $tool, ($spec['args'])('A'), self::NOT_CAL);
        }
        $this->assertSame([$this->club2->getId()], array_column($this->ok('other', 'list_clubs'), 'id'));
    }
}
