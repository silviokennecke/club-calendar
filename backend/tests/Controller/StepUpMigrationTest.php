<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Every sensitive account route needs the step-up token; the gates still let a restricted session delete the account. */
class StepUpMigrationTest extends WebTestCase
{
    use ClockSensitiveTrait;

    /** The routes that carry #[RequiresStepUp] (method, path). */
    private const array ROUTES = [
        ['DELETE', '/api/auth/me'],
        ['POST', '/api/auth/change-password'],
        ['POST', '/api/auth/change-email'],
        ['POST', '/api/auth/mfa/enable'],
        ['POST', '/api/auth/mfa/disable'],
        ['POST', '/api/auth/mfa/backup-codes'],
        ['POST', '/api/auth/webauthn/register/options'],
        ['POST', '/api/auth/webauthn/register/verify'],
        ['DELETE', '/api/auth/webauthn/some-id'],
    ];

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private TokenService $tokens;

    protected function setUp(): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        $this->tokens = static::getContainer()->get(TokenService::class);
        DatabaseResetter::reset($this->em);
    }

    protected function tearDown(): void
    {
        self::mockTime();
        parent::tearDown();
    }

    private function user(string $email = 'alice@example.com', bool $verified = true): User
    {
        return TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), $email, 'password123', $verified);
    }

    /** @return array{status: int, code: ?string} */
    private function call(string $method, string $uri, string $auth, ?string $stepUp): array
    {
        $r = TestHelper::jsonRequest($this->client, $method, $uri, [], $auth, $stepUp);

        return ['status' => $r['status'], 'code' => $r['body']['code'] ?? null];
    }

    public function testEveryMigratedRouteNeedsAStepUp(): void
    {
        $user = $this->user();
        $auth = TestHelper::sessionHeader($user, $this->tokens);
        foreach (self::ROUTES as [$method, $uri]) {
            $r = $this->call($method, $uri, $auth, null);
            $this->assertSame([403, 'step_up_required'], [$r['status'], $r['code']], "$method $uri without header");
            $r = $this->call($method, $uri, $auth, 'garbage');
            $this->assertSame('step_up_required', $r['code'], "$method $uri garbage token");
        }
        $this->assertNotNull($this->em->getRepository(User::class)->findOneBy(['email' => 'alice@example.com']));
    }

    public function testForeignAndOtherSessionTokensAreRefused(): void
    {
        $alice = $this->user();
        $bob = $this->user('bob@example.com');
        [, $bobToken] = TestHelper::stepUpSession($this->client, $bob, $this->tokens);
        [$aliceAuth, $aliceToken] = TestHelper::stepUpSession($this->client, $alice, $this->tokens);
        $aliceOtherSession = TestHelper::sessionHeader($alice, $this->tokens);

        foreach (self::ROUTES as [$method, $uri]) {
            $this->assertSame('step_up_required', $this->call($method, $uri, $aliceAuth, $bobToken)['code'], "$method $uri other user");
            $this->assertSame('step_up_required', $this->call($method, $uri, $aliceOtherSession, $aliceToken)['code'], "$method $uri other session");
        }
    }

    public function testExpiredTokenIsRefused(): void
    {
        self::mockTime('2026-10-13 09:00:00 UTC');
        $user = $this->user();
        [$auth, $token] = TestHelper::stepUpSession($this->client, $user, $this->tokens);
        $this->assertNotSame('step_up_required', $this->call('POST', '/api/auth/mfa/backup-codes', $auth, $token)['code']);

        self::mockTime('+11 minutes');
        $auth = TestHelper::sessionHeader($user, $this->tokens);
        foreach (self::ROUTES as [$method, $uri]) {
            $this->assertSame('step_up_required', $this->call($method, $uri, $auth, $token)['code'], "$method $uri expired");
        }
    }

    public function testAValidTokenPassesTheStepUpCheckOfEveryRoute(): void
    {
        $user = $this->user();
        foreach (self::ROUTES as [$method, $uri]) {
            if ('DELETE' === $method && '/api/auth/me' === $uri) {
                continue;
            }
            [$auth, $token] = TestHelper::stepUpSession($this->client, $user, $this->tokens);
            $r = $this->call($method, $uri, $auth, $token);
            $this->assertNotSame('step_up_required', $r['code'], "$method $uri");
            $this->assertNotSame(401, $r['status'], "$method $uri");
        }
    }

    public function testUnverifiedSessionCanDeleteTheAccountButNothingElse(): void
    {
        $user = $this->user('new@example.com', false);
        [$auth, $token] = TestHelper::stepUpSession($this->client, $user, $this->tokens);

        foreach (self::ROUTES as [$method, $uri]) {
            if ('/api/auth/me' === $uri) {
                continue;
            }
            $this->assertSame('email_verification_required', $this->call($method, $uri, $auth, $token)['code'], "$method $uri");
        }
        $r = $this->call('DELETE', '/api/auth/me', $auth, $token);
        $this->assertSame(200, $r['status']);
        $this->em->clear();
        $this->assertNull($this->em->getRepository(User::class)->findOneBy(['email' => 'new@example.com']));
    }

    public function testTokenDiesWithTheAccountSession(): void
    {
        $user = $this->user();
        [$auth, $token] = TestHelper::stepUpSession($this->client, $user, $this->tokens);
        $this->assertSame(200, $this->call('DELETE', '/api/auth/me', $auth, $token)['status']);
        $this->assertSame(401, $this->call('DELETE', '/api/auth/me', $auth, $token)['status']);
    }
}
