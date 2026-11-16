<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\OAuthClient;
use App\Entity\User;
use App\Enum\ClubRole;
use App\OAuth\OAuthServerService;
use App\Telemetry\McpCallMetricsHandler;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TelemetryCapture;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Mcp\Capability\Attribute\McpTool;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class McpTelemetryTest extends WebTestCase
{
    use TelemetryCapture;

    private const string VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const string CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    private const string REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private User $editor;
    private string $clientId;
    private string $clubId;
    private string $calendarId;

    protected function setUp(): void
    {
        $this->enableTelemetry();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $oauthClient = new OAuthClient('Claude', [self::REDIRECT], new \DateTimeImmutable());
        $this->em->persist($oauthClient);
        $this->em->flush();
        $this->clientId = $oauthClient->getId();
        $hasher = $c->get(UserPasswordHasherInterface::class);
        $admin = TestHelper::createUser($this->em, $hasher, 'admin@example.com');
        $this->editor = TestHelper::createUser($this->em, $hasher, 'editor@example.com');
        $club = TestHelper::createClub($this->em, $admin, 'Mein Verein');
        TestHelper::addMember($this->em, $club, $this->editor, ClubRole::EDITOR);
        $this->clubId = $club->getId();
        $this->calendarId = TestHelper::createCalendar($this->em, $club, 'Hauptkalender')->getId();
        $this->clearPoints();
    }

    protected function tearDown(): void
    {
        $this->resetTelemetryEnv();
        parent::tearDown();
        self::ensureKernelShutdown();
    }

    private function token(string $scope): string
    {
        $oauth = static::getContainer()->get(OAuthServerService::class);
        $client = $this->em->find(OAuthClient::class, $this->clientId);
        $request = $oauth->createAuthorizationRequest($client, self::REDIRECT, $scope, self::CHALLENGE, 'S256', 's', null);
        $code = $oauth->approve($request, $this->em->find(User::class, $this->editor->getId()))['code'];

        return $oauth->exchangeCode($client, $code, self::REDIRECT, self::VERIFIER, null)['access_token'];
    }

    private function rpc(array $message, string $token, ?string $session = null): array
    {
        $headers = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json, text/event-stream', 'HTTP_AUTHORIZATION' => 'Bearer '.$token];
        if (null !== $session) {
            $headers['HTTP_MCP_SESSION_ID'] = $session;
        }
        $this->client->request('POST', '/api/mcp', [], [], $headers, json_encode($message));
        $response = $this->client->getResponse();

        return ['body' => json_decode((string) $response->getContent(), true), 'session' => (string) $response->headers->get('Mcp-Session-Id')];
    }

    private function call(string $tool, array $args, string $scope): array
    {
        $token = $this->token($scope);
        $init = $this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize', 'params' => [
            'protocolVersion' => '2025-06-18', 'capabilities' => new \stdClass(), 'clientInfo' => ['name' => 't', 'version' => '1'],
        ]], $token);
        $this->rpc(['jsonrpc' => '2.0', 'method' => 'notifications/initialized'], $token, $init['session']);
        $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/call', 'params' => ['name' => $tool, 'arguments' => [] === $args ? new \stdClass() : $args]], $token, $init['session']);

        return $r['body']['result'] ?? $this->fail(json_encode($r['body']));
    }

    /** @return array<string, int> "tool/access/outcome" => count */
    private function counts(): array
    {
        $out = [];
        foreach ($this->points(McpCallMetricsHandler::NAME) as $p) {
            $out[$p['attrs']['tool'].'/'.$p['attrs']['access'].'/'.$p['attrs']['outcome']] = $p['value'];
        }

        return $out;
    }

    public function testReadAndWriteCallsAreCountedOnceWithAccess(): void
    {
        $this->assertNotTrue($this->call('list_calendars', ['clubId' => $this->clubId], 'mcp:read')['isError'] ?? false);
        $this->assertNotTrue($this->call('create_feature', ['calendarId' => $this->calendarId, 'name' => 'F'], 'mcp:write')['isError'] ?? false);
        $this->assertSame(['list_calendars/read/ok' => 1, 'create_feature/write/ok' => 1], $this->counts());
    }

    public function testErrorsAndMissingScopeAreCountedAsError(): void
    {
        $this->assertTrue($this->call('create_feature', ['calendarId' => $this->calendarId, 'name' => 'F'], 'mcp:read')['isError']);
        $this->assertTrue($this->call('list_calendars', ['clubId' => '00000000-0000-7000-8000-000000000000'], 'mcp:read')['isError']);
        $this->assertSame(['create_feature/write/error' => 1, 'list_calendars/read/error' => 1], $this->counts());
    }

    public function testEveryToolDeclaresExactlyOneMatchingScope(): void
    {
        $dir = dirname(__DIR__, 2).'/src/Mcp/Tool';
        $files = glob($dir.'/*Tool.php');
        $this->assertGreaterThanOrEqual(22, count($files));
        foreach ($files as $file) {
            $class = 'App\\Mcp\\Tool\\'.basename($file, '.php');
            $attr = (new \ReflectionClass($class))->getAttributes(McpTool::class)[0]->newInstance();
            $source = (string) file_get_contents($file);
            $this->assertSame(1, preg_match_all('/requireScope\(McpScope::(Read|Write)\)/', $source, $m), $attr->name);
            $readOnly = $attr->annotations?->readOnlyHint;
            $this->assertSame('Read' === $m[1][0], true === $readOnly, $attr->name.' readOnlyHint must match its scope');
        }
    }
}
