<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Passkey;
use App\Entity\User;
use App\Security\OneTimeTokenService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Refresh tokens: stored, rotated on every use, reuse detection with a grace window, logout, sign out everywhere. */
class RefreshTokenTest extends WebTestCase
{
    private static KernelBrowser $client;
    private EntityManagerInterface $em;
    private UserPasswordHasherInterface $hasher;
    private TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        self::$client->disableReboot();
    }

    protected function setUp(): void
    {
        $container = static::getContainer();
        $this->em = $container->get(EntityManagerInterface::class);
        $this->hasher = $container->get(UserPasswordHasherInterface::class);
        $this->tokens = $container->get(TokenService::class);
        DatabaseResetter::reset($this->em);
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive across tests.
    }

    private function user(string $email = 'alice@example.com'): User
    {
        return TestHelper::createUser($this->em, $this->hasher, $email);
    }

    private function conn(): Connection
    {
        return $this->em->getConnection();
    }

    /** @return array{0: int, 1: array<string, mixed>} */
    private function refresh(string $token): array
    {
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $token]);
        $response = self::$client->getResponse();

        return [$response->getStatusCode(), json_decode((string) $response->getContent(), true)];
    }

    /** @return array<string, mixed> */
    private static function payload(string $token): array
    {
        return json_decode((string) base64_decode(explode('.', $token)[1], true), true);
    }

    private function ageRotation(string $token, int $seconds): void
    {
        $this->conn()->executeStatement(
            'UPDATE refresh_token SET rotated_at = ? WHERE id = ?',
            [(new \DateTimeImmutable("-$seconds seconds", new \DateTimeZone('UTC')))->format('Y-m-d H:i:s'), self::payload($token)['jti']],
        );
    }

    private function openRows(): int
    {
        return (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM refresh_token WHERE revoked_at IS NULL');
    }

    private function command(string $name): CommandTester
    {
        return new CommandTester((new Application(self::$client->getKernel()))->find($name));
    }

    // --- rotation ---

    public function testRefreshRotatesIntoTheSameFamily(): void
    {
        $user = $this->user();
        $first = $this->tokens->tokenResponse($user)['refresh_token'];
        $p1 = self::payload($first);
        $this->assertNotEmpty($p1['jti']);
        $this->assertNotEmpty($p1['fam']);

        [$status, $body] = $this->refresh($first);
        $this->assertSame(200, $status);
        $p2 = self::payload($body['refresh_token']);
        $this->assertSame($p1['fam'], $p2['fam']);
        $this->assertNotSame($p1['jti'], $p2['jti']);
        $this->assertNotSame($first, $body['refresh_token']);

        [$status, $again] = $this->refresh($body['refresh_token']);
        $this->assertSame(200, $status);
        $this->assertSame($p1['fam'], self::payload($again['refresh_token'])['fam']);
        $this->assertSame(3, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM refresh_token WHERE family_id = ?', [$p1['fam']]));
    }

    public function testNewTokenKeepsTheAbsoluteEndOfTheFamily(): void
    {
        $first = $this->tokens->tokenResponse($this->user())['refresh_token'];
        [, $body] = $this->refresh($first);
        $ends = $this->conn()->fetchFirstColumn('SELECT DISTINCT family_expires_at FROM refresh_token');
        $this->assertCount(1, $ends);
        $this->assertGreaterThanOrEqual(self::payload($first)['exp'], self::payload($body['refresh_token'])['exp']);
    }

    public function testReuseBeyondGraceRevokesTheFamily(): void
    {
        $first = $this->tokens->tokenResponse($this->user())['refresh_token'];
        [, $second] = $this->refresh($first);
        $this->ageRotation($first, 60);

        [$status, $body] = $this->refresh($first);
        $this->assertSame(401, $status);
        $this->assertSame('invalid_refresh_token', $body['code']);
        // The newer token of the family is gone as well.
        [$status, $body] = $this->refresh($second['refresh_token']);
        $this->assertSame(401, $status);
        $this->assertSame('invalid_refresh_token', $body['code']);
        $this->assertSame(0, $this->openRows());
    }

    public function testReuseWithinGraceGetsANewTokenWithoutRevoking(): void
    {
        $first = $this->tokens->tokenResponse($this->user())['refresh_token'];
        [, $second] = $this->refresh($first);

        [$status, $retry] = $this->refresh($first);
        $this->assertSame(200, $status);
        $this->assertSame(self::payload($first)['fam'], self::payload($retry['refresh_token'])['fam']);
        $this->assertSame(200, $this->refresh($second['refresh_token'])[0], 'the first answer stays valid');
        $this->assertSame(200, $this->refresh($retry['refresh_token'])[0]);
    }

    public function testOnlyOneOfTwoParallelRotationsWinsTheUpdate(): void
    {
        $token = $this->tokens->tokenResponse($this->user())['refresh_token'];
        $jti = self::payload($token)['jti'];
        $repo = static::getContainer()->get(\App\Repository\RefreshTokenRepository::class);
        $now = new \DateTimeImmutable();
        $this->assertTrue($repo->markRotated($jti, $now));
        $this->assertFalse($repo->markRotated($jti, $now), 'the conditional UPDATE lets only the first request rotate');
    }

    public function testAbsoluteLifetimeEndsTheSession(): void
    {
        $first = $this->tokens->tokenResponse($this->user())['refresh_token'];
        $past = (new \DateTimeImmutable('-1 minute', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s');
        $this->conn()->executeStatement('UPDATE refresh_token SET family_expires_at = ?', [$past]);
        [$status, $body] = $this->refresh($first);
        $this->assertSame(401, $status);
        $this->assertSame('invalid_refresh_token', $body['code']);
    }

    public function testTokenNeverOutlivesTheFamily(): void
    {
        $user = $this->user();
        $end = (new \DateTimeImmutable('+1 hour', new \DateTimeZone('UTC')));
        $token = $this->tokens->createRefreshToken($user, null, $end);
        $this->assertSame($end->getTimestamp(), self::payload($token)['exp']);
    }

    public function testUnknownTokenOfValidSignatureFails(): void
    {
        $token = $this->tokens->tokenResponse($this->user())['refresh_token'];
        $this->conn()->executeStatement('DELETE FROM refresh_token');
        $this->assertSame(401, $this->refresh($token)[0]);
    }

    public function testLegacyTokenWithoutJtiIsAcceptedAndStartsAFamily(): void
    {
        $user = $this->user();
        $legacy = $this->legacyToken($user);
        [$status, $body] = $this->refresh($legacy);
        $this->assertSame(200, $status);
        $this->assertNotEmpty(self::payload($body['refresh_token'])['fam']);
        $this->assertSame(1, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM refresh_token'));
        // The replacement rotates normally.
        $this->assertSame(200, $this->refresh($body['refresh_token'])[0]);
    }

    private function legacyToken(User $user): string
    {
        return $this->signed(['sub' => $user->getId(), 'exp' => time() + 3600, 'type' => 'refresh', 'uid' => $user->getId(), 'tv' => $user->getTokenVersion()]);
    }

    /** @param array<string, mixed> $claims */
    private function signed(array $claims): string
    {
        $secret = $_SERVER['JWT_REFRESH_SECRET'] ?? $_ENV['JWT_REFRESH_SECRET'] ?? getenv('JWT_REFRESH_SECRET');
        $header = base64_encode((string) json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $body = base64_encode((string) json_encode($claims));

        return "$header.$body.".base64_encode(hash_hmac('sha256', "$header.$body", (string) $secret, true));
    }

    public function testLegacyTokenIsAcceptedOnlyOnce(): void
    {
        $legacy = $this->legacyToken($this->user());
        $this->assertSame(200, $this->refresh($legacy)[0]);
        [$status, $body] = $this->refresh($legacy);
        $this->assertSame(401, $status);
        $this->assertSame('invalid_refresh_token', $body['code']);
    }

    public function testSignedTokenThatDoesNotMatchItsRowIsRejected(): void
    {
        $alice = $this->user();
        $bob = $this->user('bob@example.com');
        $aliceToken = $this->tokens->tokenResponse($alice)['refresh_token'];
        $a = self::payload($aliceToken);
        $claims = fn (User $u, string $jti, string $fam): array => [
            'sub' => $u->getId(), 'exp' => time() + 3600, 'type' => 'refresh', 'uid' => $u->getId(), 'tv' => $u->getTokenVersion(), 'jti' => $jti, 'fam' => $fam,
        ];
        // Bob's valid signature, Alice's row.
        $this->assertSame(401, $this->refresh($this->signed($claims($bob, $a['jti'], $a['fam'])))[0]);
        // Right user and row, wrong family.
        $this->assertSame(401, $this->refresh($this->signed($claims($alice, $a['jti'], 'other-family')))[0]);
        // Unknown row.
        $this->assertSame(401, $this->refresh($this->signed($claims($alice, 'no-such-jti', $a['fam'])))[0]);
        $this->assertSame(200, $this->refresh($aliceToken)[0], 'the real token is untouched');
    }

    public function testRevokedFamilyStaysRevokedInsideTheGraceWindow(): void
    {
        $first = $this->tokens->tokenResponse($this->user())['refresh_token'];
        [, $second] = $this->refresh($first);
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout', ['refresh_token' => $second['refresh_token']]);
        // `first` was rotated just now (inside the grace window), but its family is revoked.
        $this->assertSame(401, $this->refresh($first)[0]);
        $this->assertSame(401, $this->refresh($second['refresh_token'])[0]);
    }

    // --- issuance paths ---

    public function testEveryIssuancePathStartsAFamily(): void
    {
        $user = $this->user('login@example.com');
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', ['email' => 'login@example.com', 'password' => 'password123']);
        $this->assertSame(200, $r['status']);
        $this->assertNotEmpty(self::payload($r['body']['refresh_token'])['fam']);

        $code = static::getContainer()->get(OneTimeTokenService::class)->issue($user, OneTimeTokenService::PURPOSE_OAUTH_LOGIN, 30, OneTimeTokenService::challengeFor(str_repeat('v', 43)));
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'one_time_token', 'token' => $code, 'code_verifier' => str_repeat('v', 43)]);
        $sso = json_decode((string) self::$client->getResponse()->getContent(), true);
        $this->assertNotEmpty(self::payload($sso['refresh_token'])['fam']);

        $auth = 'Bearer '.$sso['access_token'];
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-password', ['currentPassword' => 'password123', 'newPassword' => 'password456'], $auth, TestHelper::stepUp(self::$client, $auth));
        $this->assertSame(200, $r['status']);
        $this->assertNotEmpty(self::payload($r['body']['refresh_token'])['fam']);

        $this->assertSame(3, (int) $this->conn()->fetchOne('SELECT COUNT(DISTINCT family_id) FROM refresh_token'));
        // Every row is backed by a token of the right user.
        $this->assertSame(0, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM refresh_token WHERE user_id <> ?', [$user->getId()]));
    }

    public function testPasswordChangeEndsOlderRefreshTokens(): void
    {
        $user = $this->user();
        $old = $this->tokens->tokenResponse($user);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-password', ['currentPassword' => 'password123', 'newPassword' => 'password456'], 'Bearer '.$old['access_token'], TestHelper::stepUp(self::$client, 'Bearer '.$old['access_token']));
        $this->assertSame(401, $this->refresh($old['refresh_token'])[0]);
        $this->assertSame(200, $this->refresh($r['body']['refresh_token'])[0]);
    }

    // --- logout ---

    public function testLogoutRevokesTheFamilyAndIsIdempotent(): void
    {
        $user = $this->user();
        $session = $this->tokens->tokenResponse($user);
        $other = $this->tokens->tokenResponse($user);
        [, $rotated] = $this->refresh($session['refresh_token']);

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout', ['refresh_token' => $rotated['refresh_token']]);
        $this->assertSame(200, $r['status']);
        $this->assertSame(['ok' => true], $r['body']);
        $this->assertSame(401, $this->refresh($rotated['refresh_token'])[0]);
        $this->assertSame(200, $this->refresh($other['refresh_token'])[0], 'other sessions stay');
        // The access token still works until it expires (stateless).
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], 'Bearer '.$rotated['access_token'])['status']);

        $again = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout', ['refresh_token' => $rotated['refresh_token']]);
        $this->assertSame(200, $again['status']);
        $this->assertSame($r['body'], $again['body']);
    }

    public function testLogoutIsUniformForGarbageAndMissingTokens(): void
    {
        foreach ([['refresh_token' => 'kaputt'], ['refresh_token' => 'a.b.c'], ['refresh_token' => 5], [], ['refresh_token' => '']] as $body) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout', $body);
            $this->assertSame(200, $r['status']);
            $this->assertSame(['ok' => true], $r['body']);
        }
        self::$client->request('POST', '/api/auth/logout', [], [], [], 'not json');
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
    }

    public function testLogoutAcceptsAnExpiredRefreshToken(): void
    {
        $token = $this->tokens->tokenResponse($this->user())['refresh_token'];
        $past = (new \DateTimeImmutable('-1 minute', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s');
        $this->conn()->executeStatement('UPDATE refresh_token SET expires_at = ?', [$past]);
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout', ['refresh_token' => $token]);
        $this->assertSame(0, $this->openRows());
    }

    public function testLogoutAllEndsAccessAndRefreshTokens(): void
    {
        $user = $this->user();
        $a = $this->tokens->tokenResponse($user);
        $b = $this->tokens->tokenResponse($user);
        $stranger = $this->tokens->tokenResponse($this->user('bob@example.com'));

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout-all', [], 'Bearer '.$a['access_token']);
        $this->assertSame(204, $r['status']);
        foreach ([$a, $b] as $session) {
            $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], 'Bearer '.$session['access_token'])['status']);
            $this->assertSame(401, $this->refresh($session['refresh_token'])[0]);
        }
        $this->assertSame(200, $this->refresh($stranger['refresh_token'])[0], 'other users keep their sessions');
        $this->assertSame(2, $this->openRows(), 'only the stranger\'s tokens are left open');
    }

    public function testLogoutAllRequiresSignIn(): void
    {
        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout-all')['status']);
    }

    // --- passkey deletion ---

    public function testDeletingAPasskeyEndsOtherSessionsAndReturnsFreshTokens(): void
    {
        $user = $this->user();
        $passkey = (new Passkey())->setId('pk-1')->setUser($user)->setCredentialId('cred-1')->setPublicKey('key');
        $this->em->persist($passkey);
        $this->em->flush();
        $current = $this->tokens->tokenResponse($user);
        $other = $this->tokens->tokenResponse($user);

        $r = TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/webauthn/pk-1', [], 'Bearer '.$current['access_token'], TestHelper::stepUp(self::$client, 'Bearer '.$current['access_token']));
        $this->assertSame(200, $r['status']);
        $this->assertTrue($r['body']['ok']);
        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], 'Bearer '.$other['access_token'])['status']);
        $this->assertSame(401, $this->refresh($other['refresh_token'])[0]);
        $this->assertSame(401, $this->refresh($current['refresh_token'])[0]);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], 'Bearer '.$r['body']['access_token'])['status']);
        $this->assertSame(200, $this->refresh($r['body']['refresh_token'])[0]);
    }

    // --- prune ---

    public function testPruneDeletesEndedSessionsOnly(): void
    {
        $user = $this->user();
        $live = $this->tokens->tokenResponse($user)['refresh_token'];
        $expired = $this->tokens->tokenResponse($user)['refresh_token'];
        $limited = $this->tokens->tokenResponse($user)['refresh_token'];
        $past = (new \DateTimeImmutable('-1 minute', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s');
        $this->conn()->executeStatement('UPDATE refresh_token SET expires_at = ? WHERE id = ?', [$past, self::payload($expired)['jti']]);
        $this->conn()->executeStatement('UPDATE refresh_token SET family_expires_at = ? WHERE id = ?', [$past, self::payload($limited)['jti']]);

        $tester = $this->command('app:prune-refresh-tokens');
        $this->assertSame(0, $tester->execute([]));
        $this->assertStringContainsString('Deleted 2 expired', $tester->getDisplay());
        $this->assertSame([self::payload($live)['jti']], $this->conn()->fetchFirstColumn('SELECT id FROM refresh_token'));
    }

    public function testRowsAreRemovedWithTheUser(): void
    {
        $user = $this->user();
        $this->tokens->tokenResponse($user);
        $this->conn()->executeStatement('DELETE FROM user WHERE id = ?', [$user->getId()]);
        $this->assertSame(0, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM refresh_token'));
    }
}
