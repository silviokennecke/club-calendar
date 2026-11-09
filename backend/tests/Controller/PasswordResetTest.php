<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\EmailVerification;
use App\Entity\OAuthAccount;
use App\Entity\Passkey;
use App\Entity\PasswordReset;
use App\Entity\User;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\OpaqueApi;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Forgot / reset password: no account oracle, hashed one-time tokens, expiry, single use, sessions end.
 */
class PasswordResetTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;
    private static string $frontendUrl;
    /** Client IP of this test: the rate limiter state survives test runs (cache), so every test gets its own. */
    private string $ip;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
        self::$frontendUrl = rtrim((string) $_ENV['FRONTEND_URL'], '/');
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
        $this->ip = '10.'.random_int(0, 255).'.'.random_int(0, 255).'.'.random_int(1, 254);
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive across tests (see AuthTest).
    }

    // --- helpers ---

    private function lastMailHtml(): string
    {
        $mail = $this->getMailerMessage();
        $this->assertInstanceOf(Email::class, $mail);

        return (string) $mail->getHtmlBody();
    }

    /** A unique address per run (the per-address rate limit survives test runs). */
    private static function uniqueEmail(string $name = 'alice'): string
    {
        return $name.'.'.bin2hex(random_bytes(4)).'@example.com';
    }

    /** @return array{status: int, content: string, headers: array<string, list<string>>} */
    private function forgot(string $email, array $server = []): array
    {
        self::$client->request('POST', '/api/auth/forgot-password', [], [], [
            'CONTENT_TYPE' => 'application/json',
            'REMOTE_ADDR' => $this->ip,
        ] + $server, (string) json_encode(['email' => $email]));
        $response = self::$client->getResponse();

        return ['status' => $response->getStatusCode(), 'content' => (string) $response->getContent(), 'headers' => $response->headers->all()];
    }

    private function reset(string $token, string $password = 'new-password-1'): array
    {
        return OpaqueApi::reset(self::$client, $token, $password);
    }

    /** Token from the link in the last mail of the last request (null if none was sent). */
    private function tokenFromMail(): ?string
    {
        $messages = $this->getMailerMessages();
        if ([] === $messages) {
            return null;
        }
        $email = end($messages);
        $this->assertInstanceOf(Email::class, $email);
        $this->assertSame(1, preg_match('#href="'.preg_quote(self::$frontendUrl, '#').'/reset-password\?token=([0-9a-f]{64})"#', (string) $email->getHtmlBody(), $m), (string) $email->getHtmlBody());

        return $m[1];
    }

    private function login(string $email, string $password): int
    {
        $hasRecord = null !== self::$em->getConnection()->fetchOne('SELECT opaque_record FROM user WHERE email = ?', [$email]);
        $r = $hasRecord
            ? OpaqueApi::login(self::$client, $email, $password)
            : TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', ['email' => $email, 'password' => $password]);

        return $r['status'];
    }

    private function user(string $id): User
    {
        self::$em->clear();

        return self::$em->getRepository(User::class)->find($id);
    }

    private function command(string $name): CommandTester
    {
        return new CommandTester((new Application(self::$client->getKernel()))->find($name));
    }

    // --- forgot-password: no oracle ---

    public function testForgotPasswordSendsALinkToTheFrontendWithAHashedOneTimeToken(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $r = $this->forgot($user->getEmail());

        $this->assertSame(204, $r['status']);
        $this->assertSame('', $r['content']);
        $this->assertEmailCount(1);
        $this->assertEmailAddressContains($this->getMailerMessage(), 'to', $user->getEmail());
        $token = $this->tokenFromMail();

        // Only the SHA-256 hash is stored, never the token.
        self::$em->clear();
        $rows = self::$em->getRepository(PasswordReset::class)->findAll();
        $this->assertCount(1, $rows);
        $this->assertSame(hash('sha256', $token), $rows[0]->getTokenHash());
        $this->assertNotSame($token, $rows[0]->getTokenHash());
        $this->assertNull($rows[0]->getUsedAt());
        $this->assertEqualsWithDelta(3600, $rows[0]->getExpiresAt()->getTimestamp() - $rows[0]->getCreatedAt()->getTimestamp(), 1);
    }

    public function testForgotPasswordAnswersTheSameForUnknownAddresses(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $known = $this->forgot($user->getEmail());
        $unknown = $this->forgot(self::uniqueEmail('nobody'));

        $this->assertSame(204, $unknown['status']);
        $this->assertSame($known['content'], $unknown['content']);
        $this->assertSame($known['headers']['content-type'] ?? null, $unknown['headers']['content-type'] ?? null);
        $this->assertEmailCount(0);
    }

    public function testForgotPasswordAlsoWorksForUnconfirmedAndSsoOnlyAccounts(): void
    {
        $unconfirmed = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail(), isEmailVerified: false);
        $this->assertSame(204, $this->forgot($unconfirmed->getEmail())['status']);
        $this->assertEmailCount(1);

        $sso = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail('sso'));
        $sso->setPassword(null);
        self::$em->flush();
        $this->assertSame(204, $this->forgot($sso->getEmail())['status']);
        $this->assertEmailCount(1);
    }

    public function testMailIsSentAfterTheResponse(): void
    {
        // Neither the SMTP round trip nor the token's database writes may delay only the answers for
        // existing accounts (timing oracle): token and mail are created and sent on kernel.terminate.
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $sentBeforeTerminate = null;
        $tokensBeforeTerminate = null;
        $dispatcher = static::getContainer()->get('event_dispatcher');
        $listener = function () use (&$sentBeforeTerminate, &$tokensBeforeTerminate): void {
            $sentBeforeTerminate ??= count($this->getMailerMessages());
            $tokensBeforeTerminate ??= (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM password_reset');
        };
        $dispatcher->addListener('kernel.response', $listener, -1000);
        try {
            self::$client->disableReboot();
            $this->forgot($user->getEmail());
        } finally {
            $dispatcher->removeListener('kernel.response', $listener);
            self::$client->enableReboot();
        }
        $this->assertSame(0, $sentBeforeTerminate);
        $this->assertSame(0, $tokensBeforeTerminate);
        $this->assertEmailCount(1);
        $this->assertSame(1, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM password_reset'));
    }

    public function testInvalidInputIsAValidationErrorWithCode(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/forgot-password', ['email' => 'not-an-email']);
        $this->assertSame(422, $r['status']);
        $this->assertSame('validation_failed', $r['body']['code']);
        $this->assertSame('email', $r['body']['field']);

        self::$client->request('POST', '/api/auth/forgot-password', [], [], ['CONTENT_TYPE' => 'application/json'], '{nope');
        $this->assertSame(400, self::$client->getResponse()->getStatusCode());
        $this->assertSame('invalid_request', json_decode((string) self::$client->getResponse()->getContent(), true)['code']);
    }

    public function testRateLimitPerAddressStillAnswers204ButSendsNoMail(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        for ($i = 0; $i < 3; ++$i) {
            $this->ip = '10.1.'.random_int(0, 255).'.'.random_int(1, 254);
            $this->assertSame(204, $this->forgot($user->getEmail())['status']);
            $this->assertEmailCount(1);
        }
        // Spelling variants count as the same address (normalized key).
        $this->ip = '10.2.'.random_int(0, 255).'.'.random_int(1, 254);
        $r = $this->forgot(strtoupper($user->getEmail()));
        $this->assertSame(204, $r['status']);
        $this->assertSame('', $r['content']);
        $this->assertEmailCount(0);
    }

    public function testRateLimitPerIpStillAnswers204ButSendsNoMail(): void
    {
        for ($i = 0; $i < 20; ++$i) {
            $this->assertSame(204, $this->forgot(self::uniqueEmail('nobody'))['status']);
        }
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $this->assertSame(204, $this->forgot($user->getEmail())['status']);
        $this->assertEmailCount(0);
    }

    public function testLinkIsBuiltFromTheConfiguredFrontendUrlNotFromTheHostHeader(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $this->forgot($user->getEmail(), ['HTTP_HOST' => '127.0.0.1:9999', 'HTTP_X_FORWARDED_HOST' => 'evil.example']);
        $html = $this->lastMailHtml();
        $this->assertStringNotContainsString('9999', $html);
        $this->assertNotNull($this->tokenFromMail());
    }

    public function testANewRequestInvalidatesTheOlderLink(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $this->forgot($user->getEmail());
        $first = $this->tokenFromMail();
        $this->forgot($user->getEmail());
        $second = $this->tokenFromMail();
        $this->assertNotSame($first, $second);

        $this->assertSame('invalid_reset_token', $this->reset($first)['body']['code']);
        $this->assertSame(204, $this->reset($second)['status']);
    }

    // --- reset-password ---

    public function testResetSetsThePasswordEndsAllSessionsAndIssuesNoTokens(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail(), 'old-password-1');
        $access = 'Bearer '.self::$tokens->createAccessToken($user);
        $refresh = self::$tokens->createRefreshToken($user);
        $this->forgot($user->getEmail());

        $r = $this->reset($this->tokenFromMail(), 'new-password-1');
        $this->assertSame(204, $r['status'], $r['content']);
        $this->assertSame('', $r['content']);

        $this->assertSame(200, $this->login($user->getEmail(), 'new-password-1'));
        $this->assertSame(401, $this->login($user->getEmail(), 'old-password-1'));
        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $access)['status']);
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $refresh]);
        $this->assertSame(401, self::$client->getResponse()->getStatusCode());
        $this->assertSame(1, $this->user($user->getId())->getTokenVersion());
    }

    public function testLinkWorksOnlyOnce(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        self::mockTime('2026-10-13 10:00:00 UTC');
        $this->forgot($user->getEmail());
        $token = $this->tokenFromMail();
        $this->assertSame(204, $this->reset($token, 'new-password-1')['status']);

        // A later second: the second claim must fail on used_at, not because MySQL reports an UPDATE to
        // the same value as "0 rows changed".
        self::mockTime('+1 minute');
        $again = $this->reset($token, 'other-password-2');
        $this->assertSame(400, $again['status']);
        $this->assertSame('invalid_reset_token', $again['body']['code']);
        $this->assertSame(200, $this->login($user->getEmail(), 'new-password-1'));
    }

    public function testUnknownUsedAndExpiredTokensGetTheSameAnswer(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        self::mockTime('2026-10-13 10:00:00 UTC');
        $this->forgot($user->getEmail());
        $expiring = $this->tokenFromMail();
        self::mockTime('+61 minutes');
        $expired = $this->reset($expiring);

        $this->forgot($user->getEmail());
        $used = $this->tokenFromMail();
        $this->reset($used);
        $usedAgain = $this->reset($used);
        $unknown = $this->reset(bin2hex(random_bytes(32)));

        foreach ([$expired, $usedAgain, $unknown] as $r) {
            $this->assertSame(400, $r['status']);
            $this->assertSame('invalid_reset_token', $r['body']['code']);
            $this->assertSame(['application/problem+json'], $r['headers']['content-type']);
        }
        $this->assertSame($unknown['content'], $expired['content']);
        $this->assertSame($unknown['content'], $usedAgain['content']);
    }

    public function testLinkIsValidForSixtyMinutes(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        self::mockTime('2026-10-13 10:00:00 UTC');
        $this->forgot($user->getEmail());
        $token = $this->tokenFromMail();
        self::mockTime('+59 minutes');
        $this->assertSame(204, $this->reset($token)['status']);
    }

    public function testATokenClaimedByAConcurrentRequestCannotBeUsed(): void
    {
        // The check is one conditional UPDATE (unused and not expired). A concurrent request that claimed
        // the row first leaves used_at set, the second request changes no row and fails.
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail(), 'old-password-1');
        $this->forgot($user->getEmail());
        $token = $this->tokenFromMail();
        self::$em->getConnection()->executeStatement(
            // An earlier time than the clock of the second request (not the same second, see above).
            'UPDATE password_reset SET used_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE token_hash = ?',
            [hash('sha256', $token)],
        );

        $this->assertSame('invalid_reset_token', $this->reset($token)['body']['code']);
        $this->assertSame(200, $this->login($user->getEmail(), 'old-password-1'));
        $this->assertSame(0, $this->user($user->getId())->getTokenVersion());
    }

    public function testResetAcceptsLongMultiByteSecrets(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $this->forgot($user->getEmail());
        $token = $this->tokenFromMail();

        $long = str_repeat('ä', 128);
        $this->assertSame(204, $this->reset($token, $long)['status']);
        $this->assertSame(200, $this->login($user->getEmail(), $long));
    }

    public function testResetConfirmsTheAddressAndRemovesPendingConfirmationLinks(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail(), isEmailVerified: false);
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/resend-verification', [], TestHelper::authHeader($user, self::getContainer()->get(TokenService::class)));
        $this->assertSame(1, self::$em->getRepository(EmailVerification::class)->count([]));

        $this->forgot($user->getEmail());
        $this->assertSame(204, $this->reset($this->tokenFromMail(), 'new-password-1')['status']);

        $this->assertTrue($this->user($user->getId())->isEmailVerified());
        $this->assertSame(0, self::$em->getRepository(EmailVerification::class)->count([]));
        $this->assertSame(200, $this->login($user->getEmail(), 'new-password-1'));
    }

    public function testResetOfAnUnconfirmedAccountRemovesSsoLinksAndPasskeysOfTheUnconfirmedTime(): void
    {
        // Someone pre-registered the address and linked a Microsoft account (no proof of the address).
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail(), isEmailVerified: false);
        $account = new OAuthAccount();
        $account->setUser($user)->setProvider('microsoft')->setProviderId('ms-attacker');
        $passkey = new Passkey();
        $passkey->setId('pk-1')->setUser($user)->setCredentialId('cred-1')->setPublicKey('key');
        self::$em->persist($account);
        self::$em->persist($passkey);
        self::$em->flush();

        $this->forgot($user->getEmail());
        $this->assertSame(204, $this->reset($this->tokenFromMail())['status']);

        $this->assertSame(0, self::$em->getRepository(OAuthAccount::class)->count([]));
        $this->assertSame(0, self::$em->getRepository(Passkey::class)->count([]));
    }

    public function testResetKeepsSsoLinksAndPasskeysOfAConfirmedAccount(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $account = new OAuthAccount();
        $account->setUser($user)->setProvider('google')->setProviderId('g-1');
        self::$em->persist($account);
        self::$em->flush();

        $this->forgot($user->getEmail());
        $this->assertSame(204, $this->reset($this->tokenFromMail())['status']);
        $this->assertSame(1, self::$em->getRepository(OAuthAccount::class)->count([]));
    }

    public function testSsoOnlyAccountGetsAPasswordByReset(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $user->setPassword(null);
        $account = new OAuthAccount();
        $account->setUser($user)->setProvider('google')->setProviderId('g-1');
        self::$em->persist($account);
        self::$em->flush();
        $this->assertSame(401, $this->login($user->getEmail(), 'new-password-1'));

        $this->forgot($user->getEmail());
        $this->assertSame(204, $this->reset($this->tokenFromMail(), 'new-password-1')['status']);
        $this->assertSame(200, $this->login($user->getEmail(), 'new-password-1'));
        $me = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], 'Bearer '.self::$tokens->createAccessToken($this->user($user->getId())));
        $this->assertTrue($me['body']['hasPassword']);
    }

    public function testErrorsCarryCorsHeadersAndNoInternalNames(): void
    {
        self::$client->request('POST', '/api/auth/opaque/register/start', [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ORIGIN' => self::$frontendUrl,
        ], (string) json_encode(['resetToken' => 'nope', 'registrationRequest' => str_repeat('A', 43)]));
        $response = self::$client->getResponse();
        $this->assertSame(400, $response->getStatusCode());
        $this->assertSame(self::$frontendUrl, $response->headers->get('Access-Control-Allow-Origin'));
        $body = (string) $response->getContent();
        $this->assertSame('invalid_reset_token', json_decode($body, true)['code']);
        $this->assertStringNotContainsString('App\\\\', $body);
        $this->assertStringNotContainsString('/src/', $body);
    }

    public function testTokensNeverReachTheLog(): void
    {
        $log = static::getContainer()->getParameter('kernel.logs_dir').'/test.log';
        $before = is_file($log) ? (int) filesize($log) : 0;
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $this->forgot($user->getEmail());
        $token = $this->tokenFromMail();
        $this->reset($token, 'x');
        $this->reset($token);
        $this->reset($token);
        $written = is_file($log) ? (string) file_get_contents($log, false, null, $before) : '';
        // (The debug SQL log of the test environment shows the hash; the token itself never appears.)
        $this->assertStringNotContainsString($token, $written);
    }

    // --- console commands ---

    public function testResetLinkCommandPrintsOnlyAWorkingUrl(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        $tester = $this->command('app:user:reset-link');
        $this->assertSame(0, $tester->execute(['email' => $user->getEmail()]));
        $output = trim($tester->getDisplay());
        $this->assertMatchesRegularExpression('#^'.preg_quote(self::$frontendUrl, '#').'/reset-password\?token=[0-9a-f]{64}$#', $output);
        $this->assertEmailCount(0);

        parse_str((string) parse_url($output, \PHP_URL_QUERY), $query);
        $this->assertSame(204, $this->reset($query['token'], 'new-password-1')['status']);
        $this->assertSame(200, $this->login($user->getEmail(), 'new-password-1'));
    }

    public function testResetLinkCommandFailsForUnknownUsers(): void
    {
        $tester = $this->command('app:user:reset-link');
        $this->assertSame(1, $tester->execute(['email' => 'nobody@example.com']));
        $this->assertStringNotContainsString('reset-password', $tester->getDisplay());
    }

    public function testVerifyCommandConfirmsTheAddress(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail(), 'password123', false);
        $before = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', ['email' => $user->getEmail(), 'password' => 'password123']);
        $this->assertTrue($before['body']['emailVerificationRequired']);
        $this->assertSame(0, $this->command('app:user:verify')->execute(['user' => $user->getEmail()]));
        $after = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', ['email' => $user->getEmail(), 'password' => 'password123']);
        $this->assertFalse($after['body']['emailVerificationRequired']);

        $this->assertSame(1, $this->command('app:user:verify')->execute(['user' => 'nobody@example.com']));
    }

    public function testPruneCommandDeletesExpiredLinksOnly(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail());
        self::mockTime('2026-10-13 08:00:00 UTC');
        $this->forgot($user->getEmail());
        $old = $this->tokenFromMail();
        self::$em->getConnection()->executeStatement(
            'UPDATE password_reset SET used_at = NULL, expires_at = ? WHERE token_hash = ?',
            ['2026-10-13 07:00:00', hash('sha256', $old)],
        );
        $other = TestHelper::createUser(self::$em, self::$hasher, self::uniqueEmail('bob'));
        $this->forgot($other->getEmail());
        $valid = $this->tokenFromMail();

        $tester = $this->command('app:prune-password-resets');
        $this->assertSame(0, $tester->execute([]));
        self::$em->clear();
        $left = array_map(fn (PasswordReset $r) => $r->getTokenHash(), self::$em->getRepository(PasswordReset::class)->findAll());
        $this->assertSame([hash('sha256', $valid)], $left);
    }
}
