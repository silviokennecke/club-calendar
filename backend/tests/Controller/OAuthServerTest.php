<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\OAuthClient;
use App\OAuth\OAuthServerService;
use App\OAuth\RedirectUriPolicy;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class OAuthServerTest extends WebTestCase
{
    private const string REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
    private const string VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const string CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    private KernelBrowser $client;
    private EntityManagerInterface $em;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
    }

    /** @return array{status: int, body: mixed, headers: array<string, list<string>>, content: string} */
    private function json(string $method, string $uri, array $data = []): array
    {
        return TestHelper::jsonRequest($this->client, $method, $uri, $data);
    }

    /** @return array{status: int, body: mixed, headers: array<string, list<string>>, content: string} */
    private function form(string $uri, array $params): array
    {
        $this->client->request('POST', $uri, $params);
        $r = $this->client->getResponse();

        return ['status' => $r->getStatusCode(), 'body' => json_decode((string) $r->getContent(), true), 'headers' => $r->headers->all(), 'content' => (string) $r->getContent()];
    }

    private function registerClient(): string
    {
        $r = $this->json('POST', '/api/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => [self::REDIRECT]]);
        $this->assertSame(201, $r['status']);

        return $r['body']['client_id'];
    }

    /** @return array<string, mixed> token response */
    private function tokensFor(string $clientId): array
    {
        $c = static::getContainer();
        $service = $c->get(OAuthServerService::class);
        $user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class));
        $client = $this->em->find(OAuthClient::class, $clientId);
        $request = $service->createAuthorizationRequest($client, self::REDIRECT, 'mcp:read mcp:write', self::CHALLENGE, 'S256', 'st', null);
        $code = $service->approve($request, $user)['code'];
        $r = $this->form('/api/oauth/token', [
            'grant_type' => 'authorization_code', 'client_id' => $clientId, 'code' => $code,
            'redirect_uri' => self::REDIRECT, 'code_verifier' => self::VERIFIER,
        ]);
        $this->assertSame(200, $r['status'], $r['content']);

        return $r['body'];
    }

    public function testAuthorizationServerMetadata(): void
    {
        $r = $this->json('GET', '/.well-known/oauth-authorization-server');
        $this->assertSame(200, $r['status']);
        $b = $r['body'];
        $this->assertSame('http://localhost:8080', $b['issuer']);
        $this->assertSame('http://localhost:3001/api/oauth/token', $b['token_endpoint']);
        $this->assertSame('http://localhost:3001/api/oauth/register', $b['registration_endpoint']);
        $this->assertSame('http://localhost:3001/api/oauth/revoke', $b['revocation_endpoint']);
        $this->assertSame('http://localhost:3001/api/oauth/authorize', $b['authorization_endpoint']);
        $this->assertSame(['S256'], $b['code_challenge_methods_supported']);
        $this->assertSame(['none'], $b['token_endpoint_auth_methods_supported']);
        $this->assertSame(['code'], $b['response_types_supported']);
        $this->assertSame(['authorization_code', 'refresh_token'], $b['grant_types_supported']);
        $this->assertSame(['mcp:read', 'mcp:write'], $b['scopes_supported']);
        $this->assertArrayNotHasKey('client_id_metadata_document_supported', $b);
    }

    public function testMetadataIgnoresHostHeader(): void
    {
        $this->client->request('GET', '/.well-known/oauth-authorization-server', [], [], ['HTTP_HOST' => 'localhost:9999', 'HTTP_X_FORWARDED_HOST' => 'evil.example']);
        $b = json_decode((string) $this->client->getResponse()->getContent(), true);
        $this->assertSame('http://localhost:8080', $b['issuer']);
        $this->assertStringNotContainsString('evil.example', (string) $this->client->getResponse()->getContent());
    }

    public function testProtectedResourceMetadata(): void
    {
        foreach (['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp'] as $path) {
            $r = $this->json('GET', $path);
            $this->assertSame(200, $r['status'], $path);
            $this->assertSame('http://localhost:8080/api/mcp', $r['body']['resource']);
            $this->assertSame(['http://localhost:8080'], $r['body']['authorization_servers']);
            $this->assertSame(['mcp:read', 'mcp:write'], $r['body']['scopes_supported']);
            $this->assertSame(['header'], $r['body']['bearer_methods_supported']);
        }
    }

    public function testRegistrationSucceeds(): void
    {
        $r = $this->json('POST', '/api/oauth/register', [
            'client_name' => 'Claude',
            'redirect_uris' => [self::REDIRECT, 'http://127.0.0.1:5555/callback'],
            'token_endpoint_auth_method' => 'none',
            'grant_types' => ['authorization_code', 'refresh_token'],
            'response_types' => ['code'],
            'scope' => 'mcp:write',
        ]);
        $this->assertSame(201, $r['status']);
        $this->assertStringContainsString('no-store', $r['headers']['cache-control'][0]);
        $this->assertArrayNotHasKey('client_secret', $r['body']);
        $this->assertSame('none', $r['body']['token_endpoint_auth_method']);
        $this->assertSame('mcp:read mcp:write', $r['body']['scope']);
        $client = $this->em->find(OAuthClient::class, $r['body']['client_id']);
        $this->assertSame('claude', $client->getFamily());
        $this->assertSame([self::REDIRECT, 'http://127.0.0.1:5555/callback'], $client->getRedirectUris());
    }

    /** @return iterable<string, array{array<string, mixed>, string}> */
    public static function badRegistrations(): iterable
    {
        yield 'no redirect uris' => [['client_name' => 'x'], 'invalid_redirect_uri'];
        yield 'empty redirect uris' => [['redirect_uris' => []], 'invalid_redirect_uri'];
        yield 'not a list' => [['redirect_uris' => 'https://claude.ai/api/mcp/auth_callback'], 'invalid_redirect_uri'];
        yield 'non-string uri' => [['redirect_uris' => [5]], 'invalid_redirect_uri'];
        yield 'foreign host' => [['redirect_uris' => ['https://evil.example/cb']], 'invalid_redirect_uri'];
        yield 'too many' => [['redirect_uris' => array_fill(0, 6, 'https://claude.ai/api/mcp/auth_callback')], 'invalid_redirect_uri'];
        yield 'mixed families' => [['redirect_uris' => ['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect']], 'invalid_redirect_uri'];
        yield 'name too long' => [['client_name' => str_repeat('a', 101), 'redirect_uris' => ['https://claude.ai/api/mcp/auth_callback']], 'invalid_client_metadata'];
        yield 'name not string' => [['client_name' => ['a'], 'redirect_uris' => ['https://claude.ai/api/mcp/auth_callback']], 'invalid_client_metadata'];
        yield 'secret auth' => [['token_endpoint_auth_method' => 'client_secret_basic', 'redirect_uris' => ['https://claude.ai/api/mcp/auth_callback']], 'invalid_client_metadata'];
        yield 'implicit grant' => [['grant_types' => ['implicit'], 'redirect_uris' => ['https://claude.ai/api/mcp/auth_callback']], 'invalid_client_metadata'];
        yield 'bad scope' => [['scope' => 'admin', 'redirect_uris' => ['https://claude.ai/api/mcp/auth_callback']], 'invalid_client_metadata'];
    }

    /** @param array<string, mixed> $body */
    #[\PHPUnit\Framework\Attributes\DataProvider('badRegistrations')]
    public function testRegistrationFails(array $body, string $error): void
    {
        $r = $this->json('POST', '/api/oauth/register', $body);
        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertSame($error, $r['body']['error']);
        $this->assertArrayHasKey('error_description', $r['body']);
        $this->assertStringContainsString('no-store', $r['headers']['cache-control'][0]);
        $this->assertSame(0, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM oauth_client'));
    }

    public function testRegistrationRejectsNonObjectBody(): void
    {
        $this->client->request('POST', '/api/oauth/register', [], [], ['CONTENT_TYPE' => 'application/json'], '[1,2]');
        $this->assertSame(400, $this->client->getResponse()->getStatusCode());
        $this->assertSame('invalid_client_metadata', json_decode((string) $this->client->getResponse()->getContent(), true)['error']);
    }

    public function testRegistrationIsRateLimitedPerIp(): void
    {
        for ($i = 0; $i < 10; ++$i) {
            $this->json('POST', '/api/oauth/register', ['redirect_uris' => [self::REDIRECT]]);
        }
        $r = $this->json('POST', '/api/oauth/register', ['redirect_uris' => [self::REDIRECT]]);
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
        $this->assertArrayHasKey('retry-after', $r['headers']);
    }

    public function testEmptyAllowListAcceptsAnyHttpsClient(): void
    {
        static::getContainer()->set(RedirectUriPolicy::class, new RedirectUriPolicy(''));
        $r = $this->json('POST', '/api/oauth/register', ['redirect_uris' => ['https://app.example.org/cb']]);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertNull($this->em->find(OAuthClient::class, $r['body']['client_id'])->getFamily());
        $bad = $this->json('POST', '/api/oauth/register', ['redirect_uris' => ['http://app.example.org/cb']]);
        $this->assertSame(400, $bad['status']);
    }

    public function testCodeTokenRefreshRevokeFlow(): void
    {
        $clientId = $this->registerClient();
        $first = $this->tokensFor($clientId);
        $this->assertSame('Bearer', $first['token_type']);
        $this->assertSame('mcp:read mcp:write', $first['scope']);

        $r = $this->form('/api/oauth/token', ['grant_type' => 'refresh_token', 'client_id' => $clientId, 'refresh_token' => $first['refresh_token']]);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertStringContainsString('no-store', $r['headers']['cache-control'][0]);
        $this->assertSame('no-cache', $r['headers']['pragma'][0]);
        $second = $r['body'];
        $this->assertNotSame($first['refresh_token'], $second['refresh_token']);

        $rev = $this->form('/api/oauth/revoke', ['token' => $second['refresh_token'], 'token_type_hint' => 'refresh_token', 'client_id' => $clientId]);
        $this->assertSame(200, $rev['status']);
        $this->assertSame('', $rev['content']);

        $dead = $this->form('/api/oauth/token', ['grant_type' => 'refresh_token', 'client_id' => $clientId, 'refresh_token' => $second['refresh_token']]);
        $this->assertSame(400, $dead['status']);
        $this->assertSame('invalid_grant', $dead['body']['error']);
        $this->assertNull(static::getContainer()->get(OAuthServerService::class)->resolveAccessToken($second['access_token']));
    }

    public function testRevokeAccessTokenKillsGrant(): void
    {
        $clientId = $this->registerClient();
        $t = $this->tokensFor($clientId);
        $this->assertSame(200, $this->form('/api/oauth/revoke', ['token' => $t['access_token']])['status']);
        $this->assertNull(static::getContainer()->get(OAuthServerService::class)->resolveAccessToken($t['access_token']));
    }

    public function testRevokeIsSilentForUnknownTokensAndClients(): void
    {
        $clientId = $this->registerClient();
        $this->assertSame(200, $this->form('/api/oauth/revoke', ['token' => 'nope'])['status']);
        $this->assertSame(200, $this->form('/api/oauth/revoke', ['token' => 'nope', 'client_id' => $clientId])['status']);
        $this->assertSame(200, $this->form('/api/oauth/revoke', ['token' => 'nope', 'client_id' => 'unknown'])['status']);
    }

    public function testRevokeByOtherClientDoesNothing(): void
    {
        $a = $this->registerClient();
        $b = $this->registerClient();
        $t = $this->tokensFor($a);
        $this->assertSame(200, $this->form('/api/oauth/revoke', ['token' => $t['access_token'], 'client_id' => $b])['status']);
        $this->assertNotNull(static::getContainer()->get(OAuthServerService::class)->resolveAccessToken($t['access_token']));
    }

    public function testRevokeErrors(): void
    {
        $r = $this->form('/api/oauth/revoke', []);
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_request', $r['body']['error']);
        $r = $this->form('/api/oauth/revoke', ['token' => 'x', 'token_type_hint' => 'bogus']);
        $this->assertSame(400, $r['status']);
        $this->assertSame('unsupported_token_type', $r['body']['error']);
    }

    public function testTokenEndpointErrorShapes(): void
    {
        $clientId = $this->registerClient();

        $r = $this->form('/api/oauth/token', ['grant_type' => 'authorization_code', 'client_id' => 'unknown', 'code' => 'x', 'redirect_uri' => self::REDIRECT, 'code_verifier' => self::VERIFIER]);
        $this->assertSame(401, $r['status']);
        $this->assertSame('invalid_client', $r['body']['error']);
        $this->assertStringContainsString('no-store', $r['headers']['cache-control'][0]);
        $this->assertSame('no-cache', $r['headers']['pragma'][0]);

        $r = $this->form('/api/oauth/token', ['grant_type' => 'refresh_token', 'refresh_token' => 'x']);
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_request', $r['body']['error']);

        $r = $this->form('/api/oauth/token', ['grant_type' => 'password', 'client_id' => $clientId]);
        $this->assertSame(400, $r['status']);
        $this->assertSame('unsupported_grant_type', $r['body']['error']);

        $r = $this->form('/api/oauth/token', ['grant_type' => 'authorization_code', 'client_id' => $clientId, 'code' => 'x']);
        $this->assertSame('invalid_request', $r['body']['error']);

        $r = $this->form('/api/oauth/token', ['grant_type' => 'authorization_code', 'client_id' => $clientId, 'code' => 'bad', 'redirect_uri' => self::REDIRECT, 'code_verifier' => self::VERIFIER]);
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_grant', $r['body']['error']);

        $r = $this->form('/api/oauth/token', ['grant_type' => 'refresh_token', 'client_id' => $clientId, 'refresh_token' => 'bad', 'resource' => 'https://other.example/mcp']);
        $this->assertSame('invalid_target', $r['body']['error']);

        $r = $this->form('/api/oauth/token', ['grant_type' => ['a'], 'client_id' => $clientId]);
        $this->assertSame('invalid_request', $r['body']['error']);
    }

    public function testCodeCannotBeRedeemedByAnotherClientOrTwice(): void
    {
        $a = $this->registerClient();
        $b = $this->registerClient();
        $c = static::getContainer();
        $service = $c->get(OAuthServerService::class);
        $user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class));
        $request = $service->createAuthorizationRequest($this->em->find(OAuthClient::class, $a), self::REDIRECT, null, self::CHALLENGE, 'S256', null, null);
        $code = $service->approve($request, $user)['code'];
        $params = ['grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => self::REDIRECT, 'code_verifier' => self::VERIFIER];

        $this->assertSame('invalid_grant', $this->form('/api/oauth/token', $params + ['client_id' => $b])['body']['error']);
        $this->assertSame(200, $this->form('/api/oauth/token', $params + ['client_id' => $a])['status']);
        $this->assertSame('invalid_grant', $this->form('/api/oauth/token', $params + ['client_id' => $a])['body']['error']);
    }

    public function testEndpointsNeedNoAuthAndRejectOtherMethods(): void
    {
        $this->client->request('GET', '/api/oauth/token');
        $this->assertSame(405, $this->client->getResponse()->getStatusCode());
        $this->client->request('GET', '/api/oauth/register');
        $this->assertSame(405, $this->client->getResponse()->getStatusCode());
        // a stale/invalid bearer on a public route must not break it
        $this->client->request('POST', '/api/oauth/revoke', ['token' => 'x'], [], ['HTTP_AUTHORIZATION' => 'Bearer garbage']);
        $this->assertContains($this->client->getResponse()->getStatusCode(), [200, 401]);
    }
}
