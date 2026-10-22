<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\OAuthClient;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\LegalDocumentType;
use App\OAuth\OAuthServerService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\LegalTestHelper;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class McpEndpointTest extends WebTestCase
{
    private const string VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const string CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    private const string REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
    private const string METADATA = 'http://localhost:3001/.well-known/oauth-protected-resource/api/mcp';

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private User $user;
    private string $clientId;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class));
        $oauthClient = new OAuthClient('Claude', [self::REDIRECT], new \DateTimeImmutable());
        $this->em->persist($oauthClient);
        $this->em->flush();
        $this->clientId = $oauthClient->getId();
    }

    /** @return array{access_token: string, refresh_token: string} */
    private function issue(?User $user = null, string $scope = 'mcp:read'): array
    {
        $oauth = static::getContainer()->get(OAuthServerService::class);
        $client = $this->em->find(OAuthClient::class, $this->clientId);
        $request = $oauth->createAuthorizationRequest($client, self::REDIRECT, $scope, self::CHALLENGE, 'S256', 's', null);
        $code = $oauth->approve($request, $this->em->find(User::class, ($user ?? $this->user)->getId()))['code'];

        return $oauth->exchangeCode($client, $code, self::REDIRECT, self::VERIFIER, null);
    }

    /**
     * @param array<string, mixed>  $message
     * @param array<string, string> $server
     *
     * @return array{status: int, body: mixed, headers: \Symfony\Component\HttpFoundation\ResponseHeaderBag, content: string}
     */
    private function rpc(array $message, ?string $token, array $server = [], ?string $session = null): array
    {
        $headers = [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json, text/event-stream',
        ] + $server;
        if (null !== $token) {
            $headers['HTTP_AUTHORIZATION'] = 'Bearer '.$token;
        }
        if (null !== $session) {
            $headers['HTTP_MCP_SESSION_ID'] = $session;
        }
        $this->client->request('POST', '/api/mcp', [], [], $headers, json_encode($message));
        $response = $this->client->getResponse();
        $content = (string) $response->getContent();

        return ['status' => $response->getStatusCode(), 'body' => json_decode($content, true), 'headers' => $response->headers, 'content' => $content];
    }

    private function initialize(string $token): string
    {
        $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize', 'params' => [
            'protocolVersion' => '2025-06-18', 'capabilities' => new \stdClass(), 'clientInfo' => ['name' => 'test', 'version' => '1'],
        ]], $token);
        $this->assertSame(200, $r['status'], $r['content']);
        $session = (string) $r['headers']->get('Mcp-Session-Id');
        $this->assertNotSame('', $session);
        $this->rpc(['jsonrpc' => '2.0', 'method' => 'notifications/initialized'], $token, [], $session);

        return $session;
    }

    private function assertUnauthorized(array $r, bool $invalid, string $code): void
    {
        $this->assertSame(401, $r['status'], $r['content']);
        $this->assertSame('application/problem+json', $r['headers']->get('Content-Type'));
        $this->assertSame($code, $r['body']['code']);
        $expected = ($invalid ? 'Bearer error="invalid_token", ' : 'Bearer ').'resource_metadata="'.self::METADATA.'"';
        $this->assertSame($expected, $r['headers']->get('WWW-Authenticate'));
    }

    public function testNoTokenIsChallenged(): void
    {
        $this->assertUnauthorized($this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], null), false, 'missing_token');
        $this->client->request('GET', '/api/mcp');
        $this->assertSame(401, $this->client->getResponse()->getStatusCode());
    }

    public function testBadTokensAreInvalid(): void
    {
        $this->assertUnauthorized($this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], 'not-a-token'), true, 'invalid_token');
        $this->client->request('POST', '/api/mcp', [], [], ['HTTP_AUTHORIZATION' => 'Basic abc']);
        $this->assertSame(401, $this->client->getResponse()->getStatusCode());
    }

    public function testNormalJwtIsRejectedOnMcp(): void
    {
        $jwt = static::getContainer()->get(TokenService::class)->createAccessToken($this->user);
        $this->assertUnauthorized($this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], $jwt), true, 'invalid_token');
    }

    public function testMcpTokenIsRejectedOnNormalRoutes(): void
    {
        $token = $this->issue()['access_token'];
        foreach (['/api/clubs', '/api/auth/me'] as $path) {
            $r = TestHelper::jsonRequest($this->client, 'GET', $path, [], 'Bearer '.$token);
            $this->assertSame(401, $r['status'], $path);
            $this->assertSame('invalid_token', $r['body']['code']);
        }
    }

    public function testRefreshTokenAndEndedTokensAreRejected(): void
    {
        $tokens = $this->issue();
        $this->assertUnauthorized($this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], $tokens['refresh_token']), true, 'invalid_token');

        $this->em->getConnection()->executeStatement('UPDATE mcp_token SET expires_at = ? WHERE type = ?', ['2000-01-01 00:00:00', 'access']);
        $this->assertUnauthorized($this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], $tokens['access_token']), true, 'invalid_token');

        $fresh = $this->issue();
        $this->em->getConnection()->executeStatement('UPDATE mcp_grant SET revoked_at = ?', ['2000-01-01 00:00:00']);
        $this->assertUnauthorized($this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], $fresh['access_token']), true, 'invalid_token');
    }

    public function testPreflightPassesUnauthenticated(): void
    {
        $this->client->request('OPTIONS', '/api/mcp', [], [], ['HTTP_ORIGIN' => 'http://localhost:5173', 'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST']);
        $this->assertLessThan(300, $this->client->getResponse()->getStatusCode());
    }

    public function testHandshakeListAndCallOverHttp(): void
    {
        $club = TestHelper::createClub($this->em, $this->user, 'Mein Verein');
        TestHelper::createClub($this->em, TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'other@example.com'), 'Fremd');
        $token = $this->issue()['access_token'];
        $session = $this->initialize($token);

        $list = $this->rpc(['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/list'], $token, [], $session);
        $this->assertSame(200, $list['status'], $list['content']);
        $names = array_column($list['body']['result']['tools'], 'name');
        $this->assertContains('list_clubs', $names);
        $this->assertStringContainsString('untrusted', $list['body']['result']['tools'][array_search('list_clubs', $names, true)]['description']);

        $call = $this->rpc(['jsonrpc' => '2.0', 'id' => 3, 'method' => 'tools/call', 'params' => ['name' => 'list_clubs', 'arguments' => new \stdClass()]], $token, [], $session);
        $this->assertSame(200, $call['status'], $call['content']);
        $this->assertNotSame(true, $call['body']['result']['isError'] ?? false, $call['content']);
        $text = $call['body']['result']['content'][0]['text'];
        $this->assertStringContainsString('Mein Verein', $text);
        $this->assertStringNotContainsString('Fremd', $text);
        $this->assertStringContainsString($club->getId(), $text);
    }

    public function testStatelessStyleRequestWithoutSession(): void
    {
        TestHelper::createClub($this->em, $this->user, 'Mein Verein');
        $token = $this->issue()['access_token'];
        $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/call', 'params' => ['name' => 'list_clubs', 'arguments' => new \stdClass()]], $token, ['HTTP_MCP_PROTOCOL_VERSION' => '2025-06-18']);
        // The 2025-06-18 handshake needs a session; stateless calls are refused after authentication.
        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertStringContainsString('session id', $r['content']);
    }

    public function testForeignHostAndOriginAreRejected(): void
    {
        $token = $this->issue()['access_token'];
        $init = ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize', 'params' => ['protocolVersion' => '2025-06-18', 'capabilities' => new \stdClass(), 'clientInfo' => ['name' => 't', 'version' => '1']]];

        $r = $this->rpc($init, $token, ['HTTP_ORIGIN' => 'https://evil.example']);
        $this->assertSame(403, $r['status'], $r['content']);

        $r = $this->rpc($init, $token, ['HTTP_ORIGIN' => 'http://localhost:5173']);
        $this->assertSame(200, $r['status'], $r['content']);

        // Last: the browser keeps the forged host for later requests.
        $r = $this->rpc($init, $token, ['HTTP_HOST' => 'evil.example']);
        $this->assertSame(400, $r['status'], 'framework.trusted_hosts rejects it first');
    }

    public function testConsentGateBlocksUntilAccepted(): void
    {
        $token = $this->issue()['access_token'];
        LegalTestHelper::publish($this->em, LegalDocumentType::PRIVACY);
        $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], $token);
        $this->assertSame(403, $r['status'], $r['content']);
        $this->assertSame('consent_required', $r['body']['code']);
        $this->assertNotEmpty($r['body']['documents']);
    }

    public function testUnverifiedEmailIsRefused(): void
    {
        $token = $this->issue()['access_token'];
        $this->em->getConnection()->executeStatement('UPDATE user SET is_email_verified = 0');
        $this->em->clear();
        $r = $this->rpc(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'ping'], $token);
        $this->assertSame(403, $r['status'], $r['content']);
        $this->assertSame('email_not_verified', $r['body']['code']);
    }

    public function testRateLimitPerGrant(): void
    {
        $token = $this->issue()['access_token'];
        $status = 0;
        $last = null;
        for ($i = 0; $i < 125; ++$i) {
            $last = $this->rpc(['jsonrpc' => '2.0', 'id' => $i, 'method' => 'ping'], $token);
            $status = $last['status'];
            if (429 === $status) {
                break;
            }
        }
        $this->assertSame(429, $status);
        $this->assertSame('rate_limited', $last['body']['code']);
        $this->assertNotNull($last['headers']->get('Retry-After'));
    }

    public function testRoleIsRecheckedOnEveryCall(): void
    {
        $c = static::getContainer();
        $ctx = $c->get(\App\Mcp\McpContext::class);
        $other = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class), 'viewer@example.com');
        $club = TestHelper::createClub($this->em, $this->user);
        $calendar = TestHelper::createCalendar($this->em, $club);
        $membership = TestHelper::addMember($this->em, $club, $other, ClubRole::EDITOR);
        $tokens = $this->issue($other, 'mcp:read mcp:write');
        $request = \Symfony\Component\HttpFoundation\Request::create('/api/mcp');
        $resolved = $c->get(OAuthServerService::class)->resolveAccessToken($tokens['access_token']);
        $request->attributes->set(\App\Mcp\McpContext::ATTRIBUTE, $resolved);
        $c->get('request_stack')->push($request);

        $ctx->requireRole($calendar, ClubRole::EDITOR);
        $ctx->requireScope(\App\OAuth\McpScope::Write);

        $membership->setRole(ClubRole::VIEWER);
        $this->em->flush();
        try {
            $ctx->requireRole($club, ClubRole::EDITOR);
            $this->fail('expected a forbidden error');
        } catch (\Mcp\Exception\ToolCallException $e) {
            $this->assertStringContainsString('Forbidden', $e->getMessage());
        }

        $this->em->remove($membership);
        $this->em->flush();
        $this->expectException(\Mcp\Exception\ToolCallException::class);
        $this->expectExceptionMessage('Club not found');
        $ctx->requireRole($club, ClubRole::VIEWER);
    }

    public function testReadOnlyGrantLacksWriteScope(): void
    {
        $c = static::getContainer();
        $request = \Symfony\Component\HttpFoundation\Request::create('/api/mcp');
        $request->attributes->set(\App\Mcp\McpContext::ATTRIBUTE, $c->get(OAuthServerService::class)->resolveAccessToken($this->issue()['access_token']));
        $c->get('request_stack')->push($request);
        $ctx = $c->get(\App\Mcp\McpContext::class);
        $ctx->requireScope(\App\OAuth\McpScope::Read);
        $this->expectException(\Mcp\Exception\ToolCallException::class);
        $ctx->requireScope(\App\OAuth\McpScope::Write);
    }
}
