<?php

declare(strict_types=1);

namespace App\Tests\OAuth;

use App\Entity\McpGrant;
use App\Entity\OAuthClient;
use App\Entity\User;
use App\OAuth\McpScope;
use App\OAuth\OAuthException;
use App\OAuth\OAuthServerService;
use App\Repository\McpGrantRepository;
use App\Repository\McpTokenRepository;
use App\Repository\OAuthAuthorizationCodeRepository;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Clock\MockClock;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class OAuthServerServiceTest extends KernelTestCase
{
    private const string REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
    private const string VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const string CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    private EntityManagerInterface $em;
    private MockClock $clock;
    private OAuthServerService $service;
    private User $user;
    private OAuthClient $client;

    protected function setUp(): void
    {
        self::bootKernel();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->clock = new MockClock('2026-10-22 12:00:00 UTC');
        $this->service = $this->makeService(accessTtl: 3600, refreshLifetime: 604800, absolute: 2592000, grace: 10);
        $this->user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class));
        $this->client = new OAuthClient('Claude', [self::REDIRECT, 'http://127.0.0.1/callback'], $this->clock->now());
        $this->em->persist($this->client);
        $this->em->flush();
    }

    private function makeService(int $accessTtl, int $refreshLifetime, int $absolute, int $grace): OAuthServerService
    {
        $c = static::getContainer();

        return new OAuthServerService(
            $this->em,
            $this->clock,
            $c->get(McpTokenRepository::class),
            $c->get(McpGrantRepository::class),
            $c->get(OAuthAuthorizationCodeRepository::class),
            'https://club.example/',
            $accessTtl,
            $refreshLifetime,
            $absolute,
            $grace,
        );
    }

    private function request(?string $scope = 'mcp:read', ?string $resource = null, string $redirect = self::REDIRECT)
    {
        return $this->service->createAuthorizationRequest($this->client, $redirect, $scope, self::CHALLENGE, 'S256', 'st', $resource);
    }

    private function code(?string $scope = 'mcp:read'): string
    {
        return $this->service->approve($this->request($scope), $this->user)['code'];
    }

    /** @return array{access_token: string, token_type: string, expires_in: int, refresh_token: string, scope: string} */
    private function tokens(?string $scope = 'mcp:read'): array
    {
        return $this->service->exchangeCode($this->client, $this->code($scope), self::REDIRECT, self::VERIFIER, null);
    }

    private function assertError(string $error, callable $fn): void
    {
        try {
            $fn();
        } catch (OAuthException $e) {
            self::assertSame($error, $e->getError(), $e->getMessage());

            return;
        }
        self::fail('Expected OAuthException '.$error);
    }

    private function grant(): McpGrant
    {
        $this->em->clear();

        return $this->em->getRepository(McpGrant::class)->findAll()[0];
    }

    public function testCanonicalResource(): void
    {
        self::assertSame('https://club.example/api/mcp', $this->service->canonicalResource());
    }

    public function testAuthorizationRequestDefaultsAndNormalizes(): void
    {
        $r = $this->request(null);
        self::assertSame('mcp:read', $r->getScopes());
        self::assertSame('https://club.example/api/mcp', $r->getResource());
        self::assertSame('mcp:read mcp:write', $this->request('mcp:write')->getScopes());
        self::assertSame('st', $r->getState());
    }

    public function testAuthorizationRequestRejections(): void
    {
        $this->assertError('invalid_request', fn () => $this->request(redirect: 'https://evil.example/cb'));
        $this->assertError('invalid_request', fn () => $this->service->createAuthorizationRequest($this->client, self::REDIRECT, null, self::CHALLENGE, 'plain', null, null));
        $this->assertError('invalid_request', fn () => $this->service->createAuthorizationRequest($this->client, self::REDIRECT, null, self::CHALLENGE, null, null, null));
        $this->assertError('invalid_request', fn () => $this->service->createAuthorizationRequest($this->client, self::REDIRECT, null, 'short', 'S256', null, null));
        $this->assertError('invalid_scope', fn () => $this->request('mcp:read admin'));
        $this->assertError('invalid_target', fn () => $this->request(resource: 'https://other.example/api/mcp'));
        self::assertSame('https://club.example/api/mcp', $this->request(resource: 'https://club.example/api/mcp')->getResource());
    }

    public function testLoopbackRedirectIgnoresPort(): void
    {
        self::assertSame('http://127.0.0.1:5555/callback', $this->request(redirect: 'http://127.0.0.1:5555/callback')->getRedirectUri());
        $this->assertError('invalid_request', fn () => $this->request(redirect: 'http://127.0.0.1:5555/other'));
        $this->assertError('invalid_request', fn () => $this->request(redirect: 'http://localhost:5555/callback'));
        $this->assertError('invalid_request', fn () => $this->request(redirect: 'https://claude.ai:444/api/mcp/auth_callback'));
    }

    public function testApproveStoresOnlyHashAndIsSingleUse(): void
    {
        $r = $this->request();
        $a = $this->service->approve($r, $this->user);
        self::assertSame(self::REDIRECT, $a['redirectUri']);
        self::assertSame('st', $a['state']);
        $conn = $this->em->getConnection();
        self::assertSame(hash('sha256', $a['code']), $conn->fetchOne('SELECT code_hash FROM oauth_authorization_code'));
        self::assertSame(0, (int) $conn->fetchOne('SELECT COUNT(*) FROM oauth_authorization_request'));
        $this->assertError('invalid_request', fn () => $this->service->approve($r, $this->user));
    }

    public function testApproveExpiredRequestFails(): void
    {
        $r = $this->request();
        $this->clock->sleep(601);
        $this->assertError('invalid_request', fn () => $this->service->approve($r, $this->user));
    }

    public function testDeny(): void
    {
        $r = $this->request();
        $this->service->deny($r);
        self::assertSame(0, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM oauth_authorization_request'));
    }

    public function testExchangeIssuesTokens(): void
    {
        $t = $this->tokens('mcp:write');
        self::assertSame('Bearer', $t['token_type']);
        self::assertSame(3600, $t['expires_in']);
        self::assertSame('mcp:read mcp:write', $t['scope']);
        self::assertSame(43, strlen($t['access_token']));
        self::assertNotSame($t['access_token'], $t['refresh_token']);
        $conn = $this->em->getConnection();
        self::assertSame(2, (int) $conn->fetchOne('SELECT COUNT(*) FROM mcp_token'));
        self::assertSame(0, (int) $conn->fetchOne('SELECT COUNT(*) FROM mcp_token WHERE token_hash IN (?, ?)', [$t['access_token'], $t['refresh_token']]));

        $resolved = $this->service->resolveAccessToken($t['access_token']);
        self::assertNotNull($resolved);
        self::assertSame($this->user->getId(), $resolved->user->getId());
        self::assertSame([McpScope::Read, McpScope::Write], $resolved->scopes);
        self::assertTrue($resolved->allows(McpScope::Write));
    }

    public function testWrongVerifierFails(): void
    {
        $code = $this->code();
        $this->assertError('invalid_grant', fn () => $this->service->exchangeCode($this->client, $code, self::REDIRECT, str_repeat('a', 43), null));
        self::assertSame(0, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM mcp_token'));
    }

    public function testMalformedVerifierFails(): void
    {
        $code = $this->code();
        $this->assertError('invalid_grant', fn () => $this->service->exchangeCode($this->client, $code, self::REDIRECT, 'short', null));
    }

    public function testRedirectUriMismatchFails(): void
    {
        $code = $this->code();
        $this->assertError('invalid_grant', fn () => $this->service->exchangeCode($this->client, $code, 'https://claude.ai/other', self::VERIFIER, null));
    }

    public function testResourceMismatchFails(): void
    {
        $code = $this->code();
        $this->assertError('invalid_target', fn () => $this->service->exchangeCode($this->client, $code, self::REDIRECT, self::VERIFIER, 'https://other.example/api/mcp'));
    }

    public function testExplicitCanonicalResourceAccepted(): void
    {
        $code = $this->code();
        $t = $this->service->exchangeCode($this->client, $code, self::REDIRECT, self::VERIFIER, 'https://club.example/api/mcp');
        self::assertNotEmpty($t['access_token']);
    }

    public function testOtherClientOrUnknownCodeFails(): void
    {
        $code = $this->code();
        $other = new OAuthClient('Other', [self::REDIRECT], $this->clock->now());
        $this->em->persist($other);
        $this->em->flush();
        $this->assertError('invalid_grant', fn () => $this->service->exchangeCode($other, $code, self::REDIRECT, self::VERIFIER, null));
        $this->assertError('invalid_grant', fn () => $this->service->exchangeCode($this->client, 'nope', self::REDIRECT, self::VERIFIER, null));
        $this->assertError('invalid_grant', fn () => $this->service->exchangeCode($this->client, '', self::REDIRECT, self::VERIFIER, null));
    }

    public function testExpiredCodeFails(): void
    {
        $code = $this->code();
        $this->clock->sleep(61);
        $this->assertError('invalid_grant', fn () => $this->service->exchangeCode($this->client, $code, self::REDIRECT, self::VERIFIER, null));
    }

    public function testCodeReuseRevokesGrantAndTokens(): void
    {
        $code = $this->code();
        $t = $this->service->exchangeCode($this->client, $code, self::REDIRECT, self::VERIFIER, null);
        $this->assertError('invalid_grant', fn () => $this->service->exchangeCode($this->client, $code, self::REDIRECT, self::VERIFIER, null));
        self::assertNotNull($this->grant()->getRevokedAt());
        self::assertNull($this->service->resolveAccessToken($t['access_token']));
        $this->assertError('invalid_grant', fn () => $this->service->refresh($this->client, $t['refresh_token']));
    }

    public function testRefreshRotates(): void
    {
        $t = $this->tokens();
        $this->clock->sleep(30);
        $n = $this->service->refresh($this->client, $t['refresh_token']);
        self::assertNotSame($t['refresh_token'], $n['refresh_token']);
        self::assertNotSame($t['access_token'], $n['access_token']);
        self::assertNotNull($this->service->resolveAccessToken($n['access_token']));
        // the new refresh token works again
        $this->clock->sleep(30);
        self::assertNotEmpty($this->service->refresh($this->client, $n['refresh_token'])['access_token']);
    }

    public function testRefreshReuseWithinGraceIsAllowed(): void
    {
        $t = $this->tokens();
        $this->service->refresh($this->client, $t['refresh_token']);
        $this->clock->sleep(5);
        $again = $this->service->refresh($this->client, $t['refresh_token']);
        self::assertNotEmpty($again['refresh_token']);
        self::assertNull($this->grant()->getRevokedAt());
    }

    public function testRefreshReuseAfterGraceRevokesGrant(): void
    {
        $t = $this->tokens();
        $new = $this->service->refresh($this->client, $t['refresh_token']);
        $this->clock->sleep(11);
        $this->assertError('invalid_grant', fn () => $this->service->refresh($this->client, $t['refresh_token']));
        self::assertNotNull($this->grant()->getRevokedAt());
        $this->assertError('invalid_grant', fn () => $this->service->refresh($this->client, $new['refresh_token']));
        self::assertNull($this->service->resolveAccessToken($new['access_token']));
    }

    public function testRefreshFailures(): void
    {
        $t = $this->tokens();
        $this->assertError('invalid_grant', fn () => $this->service->refresh($this->client, 'nope'));
        $this->assertError('invalid_grant', fn () => $this->service->refresh($this->client, ''));
        // an access token is not a refresh token
        $this->assertError('invalid_grant', fn () => $this->service->refresh($this->client, $t['access_token']));
        $other = new OAuthClient('Other', [self::REDIRECT], $this->clock->now());
        $this->em->persist($other);
        $this->em->flush();
        $this->assertError('invalid_grant', fn () => $this->service->refresh($other, $t['refresh_token']));
        $this->assertError('invalid_target', fn () => $this->service->refresh($this->client, $t['refresh_token'], 'https://other.example/api/mcp'));
    }

    public function testRefreshTokenExpires(): void
    {
        $t = $this->tokens();
        $this->clock->sleep(604801);
        $this->assertError('invalid_grant', fn () => $this->service->refresh($this->client, $t['refresh_token']));
    }

    public function testAbsoluteLifetimeCapsTokensAndEndsGrant(): void
    {
        $this->service = $this->makeService(accessTtl: 3600, refreshLifetime: 604800, absolute: 100, grace: 10);
        $t = $this->tokens();
        self::assertSame(100, $t['expires_in']);
        $this->clock->sleep(101);
        self::assertNull($this->service->resolveAccessToken($t['access_token']));
        $this->assertError('invalid_grant', fn () => $this->service->refresh($this->client, $t['refresh_token']));
    }

    public function testAccessTokenExpires(): void
    {
        $t = $this->tokens();
        $this->clock->sleep(3599);
        self::assertNotNull($this->service->resolveAccessToken($t['access_token']));
        $this->clock->sleep(2);
        self::assertNull($this->service->resolveAccessToken($t['access_token']));
    }

    public function testResolveRejectsGarbageAndRefreshTokens(): void
    {
        $t = $this->tokens();
        self::assertNull($this->service->resolveAccessToken(''));
        self::assertNull($this->service->resolveAccessToken('nope'));
        self::assertNull($this->service->resolveAccessToken($t['refresh_token']));
    }

    public function testResolveTouchesLastUsedThrottled(): void
    {
        $t = $this->tokens();
        $this->service->resolveAccessToken($t['access_token']);
        $conn = $this->em->getConnection();
        $first = $conn->fetchOne('SELECT last_used_at FROM mcp_grant');
        self::assertSame('2026-10-22 12:00:00', $first);
        $this->clock->sleep(10);
        $this->service->resolveAccessToken($t['access_token']);
        self::assertSame($first, $conn->fetchOne('SELECT last_used_at FROM mcp_grant'));
        $this->clock->sleep(60);
        $this->service->resolveAccessToken($t['access_token']);
        self::assertSame('2026-10-22 12:01:10', $conn->fetchOne('SELECT last_used_at FROM mcp_grant'));
    }

    public function testRevokeTokenRevokesGrant(): void
    {
        $t = $this->tokens();
        $this->service->revokeToken($t['refresh_token'], $this->client);
        self::assertNull($this->service->resolveAccessToken($t['access_token']));
        $this->assertError('invalid_grant', fn () => $this->service->refresh($this->client, $t['refresh_token']));
    }

    public function testRevokeAccessTokenAlsoRevokesGrant(): void
    {
        $t = $this->tokens();
        $this->service->revokeToken($t['access_token']);
        self::assertNull($this->service->resolveAccessToken($t['access_token']));
    }

    public function testRevokeTokenIsSilentForUnknownAndOtherClient(): void
    {
        $t = $this->tokens();
        $this->service->revokeToken('nope', $this->client);
        $this->service->revokeToken('', $this->client);
        $other = new OAuthClient('Other', [self::REDIRECT], $this->clock->now());
        $this->em->persist($other);
        $this->em->flush();
        $this->service->revokeToken($t['refresh_token'], $other);
        self::assertNotNull($this->service->resolveAccessToken($t['access_token']));
    }

    public function testRevokeAllGrantsOfUser(): void
    {
        $a = $this->tokens();
        $b = $this->tokens('mcp:write');
        self::assertSame(2, $this->service->revokeAllGrantsOfUser($this->user));
        self::assertNull($this->service->resolveAccessToken($a['access_token']));
        self::assertNull($this->service->resolveAccessToken($b['access_token']));
        self::assertSame(0, $this->service->revokeAllGrantsOfUser($this->user->getId()));
    }

    public function testRevokeAllLeavesOtherUsers(): void
    {
        $mine = $this->tokens();
        $other = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'other@example.com');
        $theirs = $this->service->exchangeCode($this->client, $this->service->approve($this->request(), $other)['code'], self::REDIRECT, self::VERIFIER, null);
        $this->service->revokeAllGrantsOfUser($this->user);
        self::assertNull($this->service->resolveAccessToken($mine['access_token']));
        self::assertNotNull($this->service->resolveAccessToken($theirs['access_token']));
    }
}
