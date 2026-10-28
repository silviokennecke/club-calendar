<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\McpGrant;
use App\Entity\OAuthAuthorizationRequest;
use App\Entity\OAuthClient;
use App\Entity\User;
use App\Enum\LegalDocumentType;
use App\OAuth\OAuthServerService;
use App\Service\Quota;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\LegalTestHelper;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class OAuthAuthorizeTest extends WebTestCase
{
    private const string REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
    private const string VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const string CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private User $user;
    private string $auth;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class));
        $this->auth = TestHelper::authHeader($this->user, $c->get(TokenService::class));
    }

    private function json(string $method, string $uri, array $data = [], ?string $auth = null): array
    {
        return TestHelper::jsonRequest($this->client, $method, $uri, $data, $auth ?? $this->auth);
    }

    private function registerClient(): string
    {
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => [self::REDIRECT]]);
        $this->assertSame(201, $r['status']);

        return $r['body']['client_id'];
    }

    /** @return array<string, string> */
    private function query(string $clientId, array $override = []): array
    {
        return array_filter($override + [
            'client_id' => $clientId, 'redirect_uri' => self::REDIRECT, 'response_type' => 'code',
            'code_challenge' => self::CHALLENGE, 'code_challenge_method' => 'S256',
            'scope' => 'mcp:read mcp:write', 'state' => 'xyz', 'resource' => 'http://localhost:8080/api/mcp',
        ], static fn ($v) => null !== $v);
    }

    private function authorize(array $query): \Symfony\Component\HttpFoundation\Response
    {
        $this->client->request('GET', '/api/oauth/authorize?'.http_build_query($query));

        return $this->client->getResponse();
    }

    private function startRequest(string $clientId): string
    {
        $res = $this->authorize($this->query($clientId));
        $this->assertSame(302, $res->getStatusCode());
        parse_str((string) parse_url((string) $res->headers->get('Location'), PHP_URL_QUERY), $q);

        return $q['request'];
    }

    /** @return array<string, string> query of the Location header */
    private static function locationQuery(string $url): array
    {
        parse_str((string) parse_url($url, PHP_URL_QUERY), $q);

        return $q;
    }

    private function resourceUri(): string
    {
        return static::getContainer()->get(OAuthServerService::class)->canonicalResource();
    }

    public function testUncleanLoopbackRedirectIsNeverRedirected(): void
    {
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/oauth/register', ['client_name' => 'X', 'redirect_uris' => ['http://127.0.0.1:7777/callback']]);
        $this->assertSame(201, $r['status']);
        $clientId = $r['body']['client_id'];
        foreach (['http://evil.example\\@127.0.0.1/callback', 'http://x@127.0.0.1/callback', 'http://127.0.0.1/callback#frag'] as $uri) {
            foreach ([['redirect_uri' => $uri], ['redirect_uri' => $uri, 'response_type' => 'token']] as $o) {
                $res = $this->authorize($this->query($clientId, $o));
                $this->assertSame(400, $res->getStatusCode(), $uri);
                $this->assertNull($res->headers->get('Location'));
            }
        }
        $this->assertSame(302, $this->authorize($this->query($clientId, ['redirect_uri' => 'http://127.0.0.1:5555/callback']))->getStatusCode());
    }

    public function testInvalidClientOrRedirectIsNeverRedirected(): void
    {
        $clientId = $this->registerClient();
        foreach ([
            $this->query('00000000-0000-7000-8000-000000000000'),
            $this->query('nope'),
            $this->query($clientId, ['redirect_uri' => 'https://evil.example/cb']),
            $this->query($clientId, ['redirect_uri' => null]),
        ] as $q) {
            $res = $this->authorize($q);
            $this->assertSame(400, $res->getStatusCode());
            $this->assertNull($res->headers->get('Location'));
            $this->assertSame('invalid_request', json_decode((string) $res->getContent(), true)['code']);
        }
    }

    public function testOtherErrorsRedirectToTheVerifiedRedirectUri(): void
    {
        $clientId = $this->registerClient();
        foreach ([
            ['response_type' => 'token', 'unsupported_response_type'],
            ['code_challenge' => null, 'invalid_request'],
            ['code_challenge_method' => 'plain', 'invalid_request'],
            ['scope' => 'admin', 'invalid_scope'],
            ['resource' => 'https://other.example/mcp', 'invalid_target'],
        ] as $case) {
            $error = array_pop($case);
            $res = $this->authorize($this->query($clientId, $case));
            $this->assertSame(302, $res->getStatusCode());
            $location = (string) $res->headers->get('Location');
            $this->assertStringStartsWith(self::REDIRECT.'?', $location);
            $q = self::locationQuery($location);
            $this->assertSame($error, $q['error'], $location);
            $this->assertNotEmpty($q['error_description']);
            $this->assertSame('xyz', $q['state']);
        }
    }

    public function testConsentFlowEndToEnd(): void
    {
        $clientId = $this->registerClient();
        $requestId = $this->startRequest($clientId);

        $info = $this->json('GET', '/api/oauth/authorization-request/'.$requestId);
        $this->assertSame(200, $info['status']);
        $this->assertSame('Claude', $info['body']['clientName']);
        $this->assertSame('claude.ai', $info['body']['redirectHost']);
        $this->assertSame('claude', $info['body']['family']);
        $this->assertSame(['mcp:read', 'mcp:write'], $info['body']['scopes']);

        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $requestId, 'approve' => true]);
        $this->assertSame(200, $d['status'], $d['content']);
        $q = self::locationQuery($d['body']['redirectUrl']);
        $this->assertStringStartsWith(self::REDIRECT.'?', $d['body']['redirectUrl']);
        $this->assertSame('xyz', $q['state']);

        $this->client->request('POST', '/api/oauth/token', [
            'grant_type' => 'authorization_code', 'client_id' => $clientId, 'code' => $q['code'],
            'redirect_uri' => self::REDIRECT, 'code_verifier' => self::VERIFIER, 'resource' => $this->resourceUri(),
        ]);
        $tokens = json_decode((string) $this->client->getResponse()->getContent(), true);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());
        $this->assertSame('mcp:read mcp:write', $tokens['scope']);

        // The request is single use
        $this->assertSame(404, $this->json('GET', '/api/oauth/authorization-request/'.$requestId)['status']);
        $again = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $requestId, 'approve' => true]);
        $this->assertSame(404, $again['status']);
        $this->assertSame('authorization_request_not_found', $again['body']['code']);
    }

    public function testDecisionNeedsASignedInUser(): void
    {
        $requestId = $this->startRequest($this->registerClient());
        $get = TestHelper::jsonRequest($this->client, 'GET', '/api/oauth/authorization-request/'.$requestId);
        $this->assertSame(401, $get['status']);
        $this->assertSame('missing_token', $get['body']['code']);
        $post = TestHelper::jsonRequest($this->client, 'POST', '/api/oauth/authorize/decision', ['requestId' => $requestId, 'approve' => true]);
        $this->assertSame(401, $post['status']);
        $this->assertSame('missing_token', $post['body']['code']);
    }

    public function testUnknownAndExpiredRequestAre404(): void
    {
        $clientId = $this->registerClient();
        $unknown = $this->json('GET', '/api/oauth/authorization-request/00000000-0000-7000-8000-000000000000');
        $this->assertSame(404, $unknown['status']);
        $this->assertSame('authorization_request_not_found', $unknown['body']['code']);

        $requestId = $this->startRequest($clientId);
        $this->em->getConnection()->executeStatement('UPDATE oauth_authorization_request SET expires_at = ? WHERE id = ?', ['2000-01-01 00:00:00', $requestId]);
        $this->assertSame(404, $this->json('GET', '/api/oauth/authorization-request/'.$requestId)['status']);
        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $requestId, 'approve' => true]);
        $this->assertSame(404, $d['status']);
        $this->assertSame('authorization_request_not_found', $d['body']['code']);
    }

    public function testDenyRedirectsWithAccessDenied(): void
    {
        $requestId = $this->startRequest($this->registerClient());
        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $requestId, 'approve' => false]);
        $this->assertSame(200, $d['status']);
        $q = self::locationQuery($d['body']['redirectUrl']);
        $this->assertSame('access_denied', $q['error']);
        $this->assertSame('xyz', $q['state']);
        $this->assertArrayNotHasKey('code', $q);
        $this->assertSame(0, $this->em->getRepository(McpGrant::class)->count([]));
        $this->assertSame(0, $this->em->getRepository(OAuthAuthorizationRequest::class)->count([]));
    }

    public function testInvalidDecisionBody(): void
    {
        $this->assertSame(400, $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => 'x'])['status']);
    }

    public function testPendingConsentBlocksApproval(): void
    {
        $requestId = $this->startRequest($this->registerClient());
        LegalTestHelper::publish($this->em, LegalDocumentType::PRIVACY);
        // The token was issued before the document existed (session `lc` true): only the service's strict check stops it
        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $requestId, 'approve' => true]);
        $this->assertSame(403, $d['status']);
        $this->assertSame('consent_required', $d['body']['code']);
        $this->assertSame(0, $this->em->getRepository(McpGrant::class)->count([]));
    }

    public function testUnverifiedEmailCannotApprove(): void
    {
        $requestId = $this->startRequest($this->registerClient());
        $this->em->getConnection()->executeStatement('UPDATE user SET is_email_verified = 0 WHERE id = ?', [$this->user->getId()]);
        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $requestId, 'approve' => true]);
        $this->assertSame(403, $d['status']);
        $this->assertSame('email_verification_required', $d['body']['code']);
    }

    public function testQuotaAndReplacementOfTheSameClient(): void
    {
        $now = new \DateTimeImmutable();
        $clients = [];
        for ($i = 0; $i < 20; ++$i) {
            $client = new OAuthClient('App '.$i, [self::REDIRECT], $now, 'claude');
            $this->em->persist($client);
            $this->em->persist(new McpGrant($this->user, $client, 'mcp:read', $now, $now->modify('+30 days')));
            $clients[] = $client;
        }
        $this->em->flush();

        // A 21st client is over the quota
        $clientId = $this->registerClient();
        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $this->startRequest($clientId), 'approve' => true]);
        $this->assertSame(422, $d['status']);
        $this->assertSame('quota_exceeded', $d['body']['code']);
        $this->assertSame(Quota::MCP_CLIENTS_PER_USER, $d['body']['resource']);
        $this->assertSame(20, $this->em->getRepository(McpGrant::class)->count(['user' => $this->user->getId()]));

        // The same client again replaces its grant instead of counting twice
        $this->em->getConnection()->executeStatement('UPDATE oauth_client SET redirect_uris = ? WHERE id = ?', [json_encode([self::REDIRECT, 'https://claude.ai/other']), $clients[0]->getId()]);
        $requestId = $this->startRequest($clients[0]->getId());
        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $requestId, 'approve' => true]);
        $this->assertSame(200, $d['status'], $d['content']);
        $this->em->clear();
        $this->assertSame(20, $this->em->getRepository(McpGrant::class)->count(['user' => $this->user->getId()]));

        // Ended grants do not count
        $this->em->getConnection()->executeStatement('UPDATE mcp_grant SET revoked_at = ? WHERE client_id = ?', ['2000-01-01 00:00:00', $clients[1]->getId()]);
        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $this->startRequest($clientId), 'approve' => true]);
        $this->assertSame(200, $d['status'], $d['content']);
    }

    public function testGrantsListAndRevoke(): void
    {
        $clientId = $this->registerClient();
        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $this->startRequest($clientId), 'approve' => true]);
        $code = self::locationQuery($d['body']['redirectUrl'])['code'];
        $this->client->request('POST', '/api/oauth/token', [
            'grant_type' => 'authorization_code', 'client_id' => $clientId, 'code' => $code,
            'redirect_uri' => self::REDIRECT, 'code_verifier' => self::VERIFIER,
        ]);
        $tokens = json_decode((string) $this->client->getResponse()->getContent(), true);

        $list = $this->json('GET', '/api/auth/mcp-grants');
        $this->assertSame(200, $list['status']);
        $this->assertCount(1, $list['body']);
        $grant = $list['body'][0];
        $this->assertSame('Claude', $grant['clientName']);
        $this->assertSame('claude', $grant['family']);
        $this->assertSame(['mcp:read', 'mcp:write'], $grant['scopes']);
        $this->assertNull($grant['lastUsedAt']);

        // Another user sees and can delete nothing
        $other = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class));
        $otherAuth = TestHelper::authHeader($other, static::getContainer()->get(TokenService::class));
        $this->assertSame([], $this->json('GET', '/api/auth/mcp-grants', [], $otherAuth)['body']);
        $denied = $this->json('DELETE', '/api/auth/mcp-grants/'.$grant['id'], [], $otherAuth);
        $this->assertSame(404, $denied['status']);
        $this->assertSame('mcp_grant_not_found', $denied['body']['code']);
        $this->assertSame(404, $this->json('DELETE', '/api/auth/mcp-grants/not-an-id')['status']);
        $this->assertSame(401, TestHelper::jsonRequest($this->client, 'GET', '/api/auth/mcp-grants')['status']);

        $service = static::getContainer()->get(OAuthServerService::class);
        $this->assertNotNull($service->resolveAccessToken($tokens['access_token']));
        $this->assertSame(204, $this->json('DELETE', '/api/auth/mcp-grants/'.$grant['id'])['status']);
        $this->assertSame([], $this->json('GET', '/api/auth/mcp-grants')['body']);
        $this->assertNull($service->resolveAccessToken($tokens['access_token']));
        $this->client->request('POST', '/api/oauth/token', ['grant_type' => 'refresh_token', 'client_id' => $clientId, 'refresh_token' => $tokens['refresh_token']]);
        $this->assertSame(400, $this->client->getResponse()->getStatusCode());
    }

    public function testLogoutAllRevokesGrants(): void
    {
        $clientId = $this->registerClient();
        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $this->startRequest($clientId), 'approve' => true]);
        $this->client->request('POST', '/api/oauth/token', [
            'grant_type' => 'authorization_code', 'client_id' => $clientId, 'code' => self::locationQuery($d['body']['redirectUrl'])['code'],
            'redirect_uri' => self::REDIRECT, 'code_verifier' => self::VERIFIER,
        ]);
        $tokens = json_decode((string) $this->client->getResponse()->getContent(), true);
        $service = static::getContainer()->get(OAuthServerService::class);
        $this->assertNotNull($service->resolveAccessToken($tokens['access_token']));

        $this->assertSame(204, $this->json('POST', '/api/auth/logout-all')['status']);

        $this->assertNull($service->resolveAccessToken($tokens['access_token']));
        $this->client->request('POST', '/api/oauth/token', ['grant_type' => 'refresh_token', 'client_id' => $clientId, 'refresh_token' => $tokens['refresh_token']]);
        $this->assertSame(400, $this->client->getResponse()->getStatusCode());
    }

    public function testPasswordChangeRevokesGrants(): void
    {
        $clientId = $this->registerClient();
        $d = $this->json('POST', '/api/oauth/authorize/decision', ['requestId' => $this->startRequest($clientId), 'approve' => true]);
        $this->client->request('POST', '/api/oauth/token', [
            'grant_type' => 'authorization_code', 'client_id' => $clientId, 'code' => self::locationQuery($d['body']['redirectUrl'])['code'],
            'redirect_uri' => self::REDIRECT, 'code_verifier' => self::VERIFIER,
        ]);
        $tokens = json_decode((string) $this->client->getResponse()->getContent(), true);

        $r = $this->json('POST', '/api/auth/change-password', ['currentPassword' => 'password123', 'newPassword' => 'another-pass-123']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertNull(static::getContainer()->get(OAuthServerService::class)->resolveAccessToken($tokens['access_token']));
    }
}
