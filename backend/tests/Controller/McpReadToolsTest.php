<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
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

class McpReadToolsTest extends WebTestCase
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

    private function token(User $user, string $scope = 'mcp:read'): string
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

    /** @return array{status: int, body: mixed} */
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
    private function call(User $user, string $tool, array $args = [], string $scope = 'mcp:read'): array
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

    public function testToolListIsExact(): void
    {
        $token = $this->token($this->viewer);
        $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/list'], $token, $this->session($token));
        $names = array_column($r['body']['result']['tools'], 'name');
        $expected = ['list_clubs', 'list_calendars', 'list_events', 'get_event', 'list_target_groups', 'list_properties', 'list_features', 'list_locations', 'list_event_templates', 'get_event_template', 'list_feeds', 'get_feed'];
        sort($names);
        sort($expected);
        $this->assertSame($expected, $names);
        foreach ($r['body']['result']['tools'] as $tool) {
            $this->assertStringContainsString('untrusted', $tool['description'], $tool['name']);
        }
    }

    public function testReadToolsAreOpenToViewers(): void
    {
        $tg = TestHelper::createTargetGroup($this->em, $this->club, 'Jugend');
        TestHelper::createLocation($this->em, $this->club, 'Halle');
        TestHelper::createProperty($this->em, $this->calendar, 'Tracht');
        TestHelper::createFeature($this->em, $this->calendar, 'Bonus');
        $template = TestHelper::createTemplate($this->em, $this->calendar, ['name' => 'Training']);
        $cid = $this->calendar->getId();
        $club = $this->club->getId();

        $this->assertSame('Hauptkalender', $this->ok($this->viewer, 'list_calendars', ['clubId' => $club])[0]['name']);
        $this->assertSame($tg->getId(), $this->ok($this->viewer, 'list_target_groups', ['clubId' => $club])[0]['id']);
        $this->assertSame('Halle', $this->ok($this->viewer, 'list_locations', ['clubId' => $club])[0]['name']);
        $this->assertSame('Tracht', $this->ok($this->viewer, 'list_properties', ['calendarId' => $cid])[0]['name']);
        $this->assertSame('Bonus', $this->ok($this->viewer, 'list_features', ['calendarId' => $cid])[0]['name']);
        $this->assertSame('Training', $this->ok($this->viewer, 'list_event_templates', ['calendarId' => $cid])[0]['name']);
        $this->assertSame($template->getId(), $this->ok($this->viewer, 'get_event_template', ['calendarId' => $cid, 'templateId' => $template->getId()])['id']);
        $this->assertError($this->call($this->viewer, 'get_event_template', ['calendarId' => $cid, 'templateId' => 'nope']), 'not found');
    }

    public function testNonMemberAndUnknownIdsLookTheSame(): void
    {
        $cid = $this->calendar->getId();
        $club = $this->club->getId();
        $unknown = '00000000-0000-7000-8000-000000000000';
        foreach (['list_calendars' => 'clubId', 'list_target_groups' => 'clubId', 'list_locations' => 'clubId', 'list_feeds' => 'clubId'] as $tool => $key) {
            $this->assertError($this->call($this->outsider, $tool, [$key => $club]), 'Club not found.');
            $this->assertError($this->call($this->outsider, $tool, [$key => $unknown]), 'Club not found.');
        }
        foreach (['list_events', 'list_properties', 'list_features', 'list_event_templates'] as $tool) {
            $this->assertError($this->call($this->outsider, $tool, ['calendarId' => $cid]), 'Calendar not found.');
            $this->assertError($this->call($this->outsider, $tool, ['calendarId' => $unknown]), 'Calendar not found.');
        }
        $this->assertError($this->call($this->outsider, 'get_event', ['calendarId' => $cid, 'eventId' => $unknown]), 'Calendar not found.');
        $this->assertError($this->call($this->outsider, 'get_feed', ['clubId' => $club, 'feedId' => $unknown]), 'Club not found.');
        $this->assertSame([], $this->ok($this->outsider, 'list_clubs'));
    }

    public function testDraftsAreHiddenFromViewers(): void
    {
        $draft = TestHelper::createEvent($this->em, $this->calendar, ['name' => 'Entwurf', 'isDraft' => true]);
        $pub = TestHelper::createEvent($this->em, $this->calendar, ['name' => 'Fest', 'isDraft' => false, 'date' => '2026-07-02']);
        $cid = $this->calendar->getId();

        $viewer = $this->ok($this->viewer, 'list_events', ['calendarId' => $cid]);
        $this->assertSame(1, $viewer['total']);
        $this->assertSame('Fest', $viewer['items'][0]['name']);
        foreach ([$this->editor, $this->admin] as $user) {
            $this->assertSame(2, $this->ok($user, 'list_events', ['calendarId' => $cid])['total']);
            $this->assertSame('Entwurf', $this->ok($user, 'get_event', ['calendarId' => $cid, 'eventId' => $draft->getId()])['name']);
        }
        $this->assertError($this->call($this->viewer, 'get_event', ['calendarId' => $cid, 'eventId' => $draft->getId()]), 'not found');
        $this->assertSame('Fest', $this->ok($this->viewer, 'get_event', ['calendarId' => $cid, 'eventId' => $pub->getId()])['name']);
    }

    public function testEventFiltersAndCaps(): void
    {
        $cid = $this->calendar->getId();
        TestHelper::createEvent($this->em, $this->calendar, ['name' => 'Alpha', 'isDraft' => false, 'date' => '2026-07-01']);
        TestHelper::createEvent($this->em, $this->calendar, ['name' => 'Beta', 'isDraft' => false, 'date' => '2026-08-01']);

        $r = $this->ok($this->viewer, 'list_events', ['calendarId' => $cid, 'from' => '2026-07-15', 'to' => '2026-08-31']);
        $this->assertSame(['Beta'], array_column($r['items'], 'name'));
        $r = $this->ok($this->viewer, 'list_events', ['calendarId' => $cid, 'q' => 'alp']);
        $this->assertSame(['Alpha'], array_column($r['items'], 'name'));
        $r = $this->ok($this->viewer, 'list_events', ['calendarId' => $cid, 'limit' => 1, 'offset' => 1]);
        $this->assertSame(2, $r['total']);
        $this->assertSame(['Beta'], array_column($r['items'], 'name'));

        $this->assertError($this->call($this->viewer, 'list_events', ['calendarId' => $cid, 'from' => '2026-07-01', 'to' => '2036-07-01']), 'to');
        $this->assertError($this->call($this->viewer, 'list_events', ['calendarId' => $cid, 'from' => '01.07.2026']), 'from');
        $this->assertError($this->call($this->viewer, 'list_events', ['calendarId' => $cid, 'limit' => 5001]), 'limit');
        $this->assertError($this->call($this->viewer, 'list_events', ['calendarId' => $cid, 'q' => str_repeat('a', 101)]), 'q');
    }

    public function testFeedsNeedEditorAndCarrySecret(): void
    {
        $feed = TestHelper::createFeed($this->em, $this->club, [$this->calendar], \App\Enum\FeedVisibility::PRIVATE, 'Privat', 'geheim-123');
        $club = $this->club->getId();

        foreach (['list_feeds' => ['clubId' => $club], 'get_feed' => ['clubId' => $club, 'feedId' => $feed->getId()]] as $tool => $args) {
            $this->assertError($this->call($this->viewer, $tool, $args), 'Forbidden');
            foreach ([$this->editor, $this->admin] as $user) {
                $r = $this->call($user, $tool, $args);
                $this->assertFalse($r['error'], $r['text']);
                $this->assertStringContainsString('geheim-123', $r['text']);
            }
        }
    }

    public function testArchivedCalendarIsReadable(): void
    {
        TestHelper::createEvent($this->em, $this->calendar, ['name' => 'Alt', 'isDraft' => false]);
        $this->calendar->setArchivedAt(new \DateTimeImmutable());
        $this->em->flush();
        $cid = $this->calendar->getId();

        $this->assertSame(1, $this->ok($this->viewer, 'list_events', ['calendarId' => $cid])['total']);
        $this->assertSame([], $this->ok($this->viewer, 'list_calendars', ['clubId' => $this->club->getId()]));
        $this->assertCount(1, $this->ok($this->viewer, 'list_calendars', ['clubId' => $this->club->getId(), 'includeArchived' => true]));
    }

    public function testScopeIsRequired(): void
    {
        $token = $this->token($this->viewer);
        $this->assertNotSame('', $token);
        $r = $this->call($this->admin, 'list_calendars', ['clubId' => $this->club->getId()], 'mcp:write');
        $this->assertFalse($r['error'], $r['text']);
    }
}
