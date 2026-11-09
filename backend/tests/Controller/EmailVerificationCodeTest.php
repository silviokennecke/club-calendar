<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\EmailVerification;
use App\Entity\User;
use App\Security\OneTimeTokenService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\OpaqueApi;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * E-mail confirmation by a 6-digit code: lifecycle of the code, resend cooldown and limits, and the restricted
 * session of an unconfirmed user (registration, login, refresh, SSO code) that alone may confirm the address.
 */
class EmailVerificationCodeTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private static KernelBrowser $client;
    private EntityManagerInterface $em;
    private UserPasswordHasherInterface $hasher;
    /** @var array<string, string> access token of the restricted session per address */
    private array $bearer = [];

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
    }

    protected function setUp(): void
    {
        $container = static::getContainer();
        $this->em = $container->get(EntityManagerInterface::class);
        $this->hasher = $container->get(UserPasswordHasherInterface::class);
        DatabaseResetter::reset($this->em);
        $this->bearer = [];
        self::mockTime('2026-10-16 10:00:00 UTC');
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive across tests (MailerAssertionsTrait needs it).
    }

    // --- helpers ---

    private function post(string $uri, array $body, string $auth = ''): array
    {
        return TestHelper::jsonRequest(self::$client, 'POST', $uri, $body, $auth);
    }

    /** POST with the restricted session of the address (signs in with the default password when there is none yet). */
    private function postAs(string $email, string $uri, array $body = []): array
    {
        if (!isset($this->bearer[$email])) {
            $login = $this->post('/api/auth/login', ['email' => $email, 'password' => 'password123']);
            $this->assertSame(200, $login['status'], $login['content']);
            $this->bearer[$email] = $login['body']['access_token'];
        }

        return $this->post($uri, $body, 'Bearer '.$this->bearer[$email]);
    }

    private function resend(string $email): array
    {
        return $this->postAs($email, '/api/auth/resend-verification');
    }

    /** Registers and returns the code from the mail. */
    private function register(string $email = 'new@example.com'): string
    {
        $r = OpaqueApi::signup(self::$client, 'New', $email, 'password123');
        $this->assertSame(201, $r['status'], $r['content']);
        $this->bearer[$email] = $r['body']['access_token'];

        return $this->codeFromLastMail($email);
    }

    private function codeFromLastMail(string $to): string
    {
        $mails = array_values(array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email));
        $this->assertNotEmpty($mails, 'no mail was sent');
        $mail = end($mails);
        $this->assertSame($to, $mail->getTo()[0]->getAddress());
        $html = (string) $mail->getHtmlBody();
        $this->assertSame(1, preg_match('/>\s*(\d{6})\s*</', $html, $m), $html);

        return $m[1];
    }

    private function verify(string $email, string $code): array
    {
        return $this->postAs($email, '/api/auth/verify-email', ['code' => $code]);
    }

    private function grant(string $token): array
    {
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'one_time_token', 'token' => $token, 'code_verifier' => str_repeat('v', 43)]);
        $response = self::$client->getResponse();

        return ['status' => $response->getStatusCode(), 'body' => json_decode((string) $response->getContent(), true)];
    }

    private function user(string $email): User
    {
        $this->em->clear();

        return $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
    }

    private function wrongCode(string $code): string
    {
        return '000000' === $code ? '111111' : '000000';
    }

    private function unverifiedUser(string $email = 'u@example.com'): User
    {
        return TestHelper::createUser($this->em, $this->hasher, $email, 'password123', false);
    }

    // --- register ---

    public function testRegisterIssuesARestrictedSessionAndRequiresTheCode(): void
    {
        $r = OpaqueApi::signup(self::$client, 'New', 'new@example.com', 'password123');
        $this->assertSame(201, $r['status']);
        $this->assertTrue($r['body']['verificationRequired']);
        $this->assertSame('new@example.com', $r['body']['email']);
        $this->assertTrue($r['body']['emailVerificationRequired']);
        $this->assertNotEmpty($r['body']['access_token']);
        $this->assertNotEmpty($r['body']['refresh_token']);
        $this->assertEmailCount(1);
        $mail = $this->getMailerMessage();
        $this->assertInstanceOf(Email::class, $mail);
        $html = (string) $mail->getHtmlBody();
        $this->assertStringNotContainsString('verify-email', $html);
        $this->assertDoesNotMatchRegularExpression('#<a [^>]*href="https?://#', $html);
        $this->assertFalse($this->user('new@example.com')->isEmailVerified());

        // Only a bcrypt hash of the code is stored.
        $code = $this->codeFromLastMail('new@example.com');
        $stored = $this->em->getConnection()->fetchOne('SELECT token_hash FROM email_verification');
        $this->assertNotSame($code, $stored);
        $this->assertStringStartsWith('$2y$04$', $stored);
    }

    public function testMailEmbedsTheLogoInline(): void
    {
        OpaqueApi::signup(self::$client, 'New', 'new@example.com', 'password123');
        $mail = $this->getMailerMessage();
        $this->assertInstanceOf(Email::class, $mail);
        $this->assertMatchesRegularExpression('#<img src="cid:[^"]+"#', (string) $mail->getHtmlBody());
        $this->assertCount(1, $mail->getAttachments());
        $this->assertSame('image/png', $mail->getAttachments()[0]->getMediaType().'/'.$mail->getAttachments()[0]->getMediaSubtype());
    }

    // --- code lifecycle ---

    public function testValidCodeVerifiesAndReturnsANewSession(): void
    {
        $code = $this->register();
        $old = $this->bearer['new@example.com'];

        $r = $this->verify('new@example.com', $code);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertFalse($r['body']['emailVerificationRequired']);
        $this->assertNotEmpty($r['body']['access_token']);
        $this->assertNotEmpty($r['body']['refresh_token']);
        $this->assertArrayNotHasKey('loginToken', $r['body']);
        $this->assertTrue($this->user('new@example.com')->isEmailVerified());

        // The restricted session ended, the new one is a full session.
        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], 'Bearer '.$old)['status']);
        $me = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], 'Bearer '.$r['body']['access_token']);
        $this->assertSame(200, $me['status']);
        $this->assertSame(200, OpaqueApi::login(self::$client, 'new@example.com', 'password123')['status']);
    }

    public function testWrongCodeIsInvalidAndWithoutSessionIs401(): void
    {
        $code = $this->register();

        $wrong = $this->verify('new@example.com', $this->wrongCode($code));
        $this->assertSame(422, $wrong['status']);
        $this->assertSame('invalid_verification_code', $wrong['body']['code']);
        $this->assertFalse($this->user('new@example.com')->isEmailVerified());

        $anonymous = $this->post('/api/auth/verify-email', ['code' => $code]);
        $this->assertSame(401, $anonymous['status']);
        $this->assertFalse($this->user('new@example.com')->isEmailVerified());
    }

    public function testVerifyingAnAlreadyVerifiedAccountIsTheSameInvalidCode(): void
    {
        TestHelper::createUser($this->em, $this->hasher, 'ok@example.com');
        $r = $this->verify('ok@example.com', '123456');
        $this->assertSame(422, $r['status']);
        $this->assertSame('invalid_verification_code', $r['body']['code']);
    }

    public function testCodeExpiresAfter15Minutes(): void
    {
        $code = $this->register();
        self::mockTime('+14 minutes');
        $this->assertSame(200, $this->verify('new@example.com', $code)['status']);

        DatabaseResetter::reset($this->em);
        $code = $this->register();
        self::mockTime('+16 minutes');
        $r = $this->verify('new@example.com', $code);
        $this->assertSame('invalid_verification_code', $r['body']['code']);
        $this->assertFalse($this->user('new@example.com')->isEmailVerified());
    }

    public function testCodeIsSingleUse(): void
    {
        $code = $this->register();
        $session = $this->verify('new@example.com', $code);
        $this->assertSame(200, $session['status']);
        // The restricted session ended with the confirmation; a full session cannot reuse the code either.
        $this->assertSame('invalid_token', $this->verify('new@example.com', $code)['body']['code']);
        $r = $this->post('/api/auth/verify-email', ['code' => $code], 'Bearer '.$session['body']['access_token']);
        $this->assertSame('invalid_verification_code', $r['body']['code']);
    }

    public function testFiveWrongAttemptsKillTheCode(): void
    {
        $code = $this->register();
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(422, $this->verify('new@example.com', $this->wrongCode($code))['status']);
        }
        // The right code does not help any more: a new one is needed.
        $this->assertSame(422, $this->verify('new@example.com', $code)['status']);
        $this->assertFalse($this->user('new@example.com')->isEmailVerified());

        self::mockTime('+5 minutes');
        $this->assertSame(204, $this->resend('new@example.com')['status']);
        $fresh = $this->codeFromLastMail('new@example.com');
        $this->assertSame(200, $this->verify('new@example.com', $fresh)['status']);
    }

    public function testTheFifthAttemptMayStillBeRight(): void
    {
        $code = $this->register();
        for ($i = 0; $i < 4; ++$i) {
            $this->verify('new@example.com', $this->wrongCode($code));
        }
        $this->assertSame(200, $this->verify('new@example.com', $code)['status']);
    }

    public function testANewCodeInvalidatesTheOldOne(): void
    {
        $old = $this->register();
        self::mockTime('+5 minutes');
        $this->assertSame(204, $this->resend('new@example.com')['status']);
        $new = $this->codeFromLastMail('new@example.com');

        if ($old !== $new) {
            $this->assertSame(422, $this->verify('new@example.com', $old)['status']);
        }
        $this->assertSame(200, $this->verify('new@example.com', $new)['status']);
        $this->assertSame(2, $this->em->getRepository(EmailVerification::class)->count([]));
    }

    public function testCodeWithSpacesIsAccepted(): void
    {
        $code = $this->register();
        $this->assertSame(200, $this->verify('new@example.com', substr($code, 0, 3).' '.substr($code, 3))['status']);
    }

    // --- resend ---

    public function testResendWithinFiveMinutesIs429WithRetryAt(): void
    {
        $this->register();
        self::mockTime('+2 minutes');

        $r = $this->resend('new@example.com');
        $this->assertSame(429, $r['status']);
        $this->assertSame('verification_resend_too_early', $r['body']['code']);
        $this->assertSame('2026-10-16T10:05:00Z', $r['body']['retryAt']);
        $this->assertSame('180', self::$client->getResponse()->headers->get('Retry-After'));

        self::mockTime('+3 minutes');
        $this->assertSame(204, $this->resend('new@example.com')['status']);
    }

    public function testResendForAVerifiedAccountIs204WithoutMail(): void
    {
        TestHelper::createUser($this->em, $this->hasher, 'ok@example.com');
        $this->assertSame(204, $this->resend('ok@example.com')['status']);
        $this->assertEmailCount(0);
    }

    public function testResendAndVerifyNeedASession(): void
    {
        $this->register();
        $r = $this->post('/api/auth/resend-verification', []);
        $this->assertSame(401, $r['status']);
        $this->assertSame('missing_token', $r['body']['code']);
        $this->assertSame(401, $this->post('/api/auth/verify-email', ['code' => '123456'])['status']);
    }

    public function testResendIsLimitedTo25PerIpAndDay(): void
    {
        TestHelper::createUser($this->em, $this->hasher, 'ok@example.com');
        for ($i = 0; $i < 25; ++$i) {
            $this->assertSame(204, $this->resend('ok@example.com')['status']);
        }
        $r = $this->resend('ok@example.com');
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
    }

    // --- per-account daily caps ---

    private function seedRows(User $user, int $count, int $attempts = 0): void
    {
        for ($i = 0; $i < $count; ++$i) {
            $this->em->getConnection()->executeStatement(
                'INSERT INTO email_verification (id, user_id, token_hash, expires_at, invalidated_at, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [\Symfony\Component\Uid\Uuid::v7()->toRfc4122(), $user->getId(), 'x', '2026-10-16 10:15:00', '2026-10-16 10:01:00', $attempts, '2026-10-16 10:00:00'],
            );
        }
    }

    public function testAccountIsCappedAt10CodesPerDayAndTheWindowResets(): void
    {
        $this->register();
        for ($i = 0; $i < 9; ++$i) {
            self::mockTime('+5 minutes');
            $this->assertSame(204, $this->resend('new@example.com')['status']);
        }
        $this->assertSame(10, $this->em->getRepository(EmailVerification::class)->count([]));

        self::mockTime('+5 minutes');
        $r = $this->resend('new@example.com');
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
        $this->assertGreaterThan(0, (int) self::$client->getResponse()->headers->get('Retry-After'));
        $this->assertSame(10, $this->em->getRepository(EmailVerification::class)->count([]));

        // 24 hours after the first code the window has moved on.
        self::mockTime('+23 hours +30 minutes');
        $this->assertSame(204, $this->resend('new@example.com')['status']);
        $this->assertSame(11, $this->em->getRepository(EmailVerification::class)->count([]));
    }

    public function testLoginSendsNoCodeOnceTheAccountIsCapped(): void
    {
        $user = $this->unverifiedUser();
        $this->seedRows($user, 10);
        self::mockTime('+20 minutes');
        $this->post('/api/auth/login', ['email' => 'u@example.com', 'password' => 'password123']);
        $this->assertEmailCount(0);
        $this->assertSame(10, $this->em->getRepository(EmailVerification::class)->count([]));
    }

    public function testGuessesAreCappedAt20PerDayAcrossCodes(): void
    {
        $code = $this->register();
        $user = $this->user('new@example.com');
        $this->seedRows($user, 3, 5); // 15 wrong guesses on earlier codes
        for ($i = 0; $i < 4; ++$i) {
            $this->assertSame(422, $this->verify('new@example.com', $this->wrongCode($code))['status']);
        }
        // 19 so far: the 20th guess may still be right ...
        $this->assertSame(200, $this->verify('new@example.com', $code)['status']);

        // ... but with the budget used up the right code does not help, and no new code is mailed.
        DatabaseResetter::reset($this->em);
        $code = $this->register();
        $this->seedRows($this->user('new@example.com'), 4, 5);
        $this->assertSame('invalid_verification_code', $this->verify('new@example.com', $code)['body']['code']);
        self::mockTime('+6 minutes');
        $this->assertSame(429, $this->resend('new@example.com')['status']);
        $this->assertFalse($this->user('new@example.com')->isEmailVerified());
    }

    // --- login ---

    public function testLoginOfAnUnverifiedUserIsRestrictedAndSendsACodeOnce(): void
    {
        $this->unverifiedUser();

        $r = $this->post('/api/auth/login', ['email' => 'u@example.com', 'password' => 'password123']);
        $this->assertSame(200, $r['status']);
        $this->assertTrue($r['body']['emailVerificationRequired']);
        $this->assertNotEmpty($r['body']['access_token']);
        $this->bearer['u@example.com'] = $r['body']['access_token'];
        $this->assertEmailCount(1);
        $code = $this->codeFromLastMail('u@example.com');

        // A code is waiting: no second mail.
        $this->post('/api/auth/login', ['email' => 'u@example.com', 'password' => 'password123']);
        $this->assertSame(1, $this->em->getRepository(EmailVerification::class)->count([]));

        // Entering it verifies; login is a full session from then on.
        $this->assertSame(200, $this->verify('u@example.com', $code)['status']);
        $login = $this->post('/api/auth/login', ['email' => 'u@example.com', 'password' => 'password123']);
        $this->assertSame(200, $login['status']);
        $this->assertFalse($login['body']['emailVerificationRequired']);
    }

    public function testLoginSendsANewCodeOnlyAfterTheOldOneIsGoneAndTheCooldownPassed(): void
    {
        $this->unverifiedUser();
        $this->post('/api/auth/login', ['email' => 'u@example.com', 'password' => 'password123']);

        // Expired after 15 minutes, cooldown (5) long over: a fresh code goes out.
        self::mockTime('+16 minutes');
        $this->post('/api/auth/login', ['email' => 'u@example.com', 'password' => 'password123']);
        $this->assertSame(2, $this->em->getRepository(EmailVerification::class)->count([]));
    }

    public function testLoginWithAWrongPasswordIs401AndSendsNothing(): void
    {
        $this->unverifiedUser();
        $r = $this->post('/api/auth/login', ['email' => 'u@example.com', 'password' => 'wrong-password']);
        $this->assertSame(401, $r['status']);
        $this->assertSame('invalid_credentials', $r['body']['code']);
        $this->assertEmailCount(0);
    }

    public function testUsedUpCodeIsNotReplacedByLoginWithinTheCooldown(): void
    {
        $this->unverifiedUser();
        $this->post('/api/auth/login', ['email' => 'u@example.com', 'password' => 'password123']);
        $code = $this->codeFromLastMail('u@example.com');
        for ($i = 0; $i < 5; ++$i) {
            $this->verify('u@example.com', $this->wrongCode($code));
        }
        self::mockTime('+1 minute');
        $this->post('/api/auth/login', ['email' => 'u@example.com', 'password' => 'password123']);
        $this->assertSame(1, $this->em->getRepository(EmailVerification::class)->count([]));
    }

    // --- refresh / one-time token ---

    public function testRefreshKeepsTheRestrictedSession(): void
    {
        $user = $this->unverifiedUser();
        $refresh = static::getContainer()->get(TokenService::class)->createRefreshToken($user);
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $refresh]);
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
        $body = json_decode((string) self::$client->getResponse()->getContent(), true);
        $this->assertTrue($body['emailVerificationRequired']);
        $this->assertSame(403, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], 'Bearer '.$body['access_token'])['status']);
    }

    public function testConfirmingEndsTheRefreshTokensOfTheRestrictedSession(): void
    {
        $this->unverifiedUser();
        $login = $this->post('/api/auth/login', ['email' => 'u@example.com', 'password' => 'password123']);
        $this->bearer['u@example.com'] = $login['body']['access_token'];
        $this->assertSame(200, $this->verify('u@example.com', $this->codeFromLastMail('u@example.com'))['status']);

        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $login['body']['refresh_token']]);
        $this->assertSame(401, self::$client->getResponse()->getStatusCode());
    }

    public function testOneTimeTokenOfAnotherPurposeOrTamperedIsRefused(): void
    {
        $user = $this->unverifiedUser();
        $service = static::getContainer()->get(OneTimeTokenService::class);

        $foreign = $service->issue($user, 'some.other.purpose', 30);
        $this->assertSame('invalid_grant', $this->grant($foreign)['body']['code']);

        $good = $service->issue($user, OneTimeTokenService::PURPOSE_OAUTH_LOGIN, 30, OneTimeTokenService::challengeFor(str_repeat('v', 43)));
        $tampered = substr($good, 0, -2).('AA' === substr($good, -2) ? 'BB' : 'AA');
        $this->assertSame('invalid_grant', $this->grant($tampered)['body']['code']);
        $this->assertSame('invalid_grant', $this->grant('garbage')['body']['code']);
        // An unverified user gets the restricted session.
        $session = $this->grant($good);
        $this->assertSame(200, $session['status']);
        $this->assertTrue($session['body']['emailVerificationRequired']);
    }

    public function testOneTimeTokenIsSingleUseAndExpires(): void
    {
        $user = $this->unverifiedUser();
        $service = static::getContainer()->get(OneTimeTokenService::class);
        $token = $service->issue($user, OneTimeTokenService::PURPOSE_OAUTH_LOGIN, 30, OneTimeTokenService::challengeFor(str_repeat('v', 43)));
        $this->assertSame(200, $this->grant($token)['status']);
        $this->assertSame('invalid_grant', $this->grant($token)['body']['code']);

        $token = $service->issue($user, OneTimeTokenService::PURPOSE_OAUTH_LOGIN, 30, OneTimeTokenService::challengeFor(str_repeat('v', 43)));
        self::mockTime('+31 seconds');
        $this->assertSame('invalid_grant', $this->grant($token)['body']['code']);
    }

    public function testOneTimeTokenDiesWhenTheSessionsEnd(): void
    {
        $user = $this->unverifiedUser();
        $token = static::getContainer()->get(OneTimeTokenService::class)->issue($user, OneTimeTokenService::PURPOSE_OAUTH_LOGIN, 30, OneTimeTokenService::challengeFor(str_repeat('v', 43)));
        $user->invalidateTokens();
        $this->em->flush();
        $this->assertSame('invalid_grant', $this->grant($token)['body']['code']);
    }

    public function testTokenEndpointNeedsAToken(): void
    {
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'one_time_token']);
        $this->assertSame(400, self::$client->getResponse()->getStatusCode());
    }

    // --- gate ---

    public function testRestrictedSessionReachesOnlyTheAllowList(): void
    {
        $this->register();
        $auth = 'Bearer '.$this->bearer['new@example.com'];
        $get = fn (string $uri) => TestHelper::jsonRequest(self::$client, 'GET', $uri, [], $auth);

        foreach (['/api/clubs', '/api/invitations', '/api/auth/mcp-grants'] as $uri) {
            $r = $get($uri);
            $this->assertSame(403, $r['status'], $uri);
            $this->assertSame('email_verification_required', $r['body']['code'], $uri);
            $this->assertSame('new@example.com', $r['body']['email']);
        }
        $this->assertSame('email_verification_required', $this->post('/api/auth/change-password', ['currentPassword' => 'password123', 'newPassword' => 'password456'], $auth)['body']['code']);
        $this->assertSame('email_verification_required', $this->post('/api/auth/logout-all', [], $auth)['body']['code']);

        $me = $get('/api/auth/me');
        $this->assertSame(200, $me['status']);
        $this->assertTrue($me['body']['emailVerificationRequired']);
        $this->assertSame(200, $get('/api/auth/consents')['status']);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['name' => 'Renamed'], $auth)['status']);
        $this->assertSame(200, $get('/api/legal')['status']);
    }

    public function testVerifiedSessionIsNotGated(): void
    {
        $this->register();
        $r = $this->verify('new@example.com', $this->codeFromLastMail('new@example.com'));
        $auth = 'Bearer '.$r['body']['access_token'];
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $auth)['status']);
        $this->assertFalse(TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $auth)['body']['emailVerificationRequired']);
    }

    // --- pre-hijack ---

    public function testTheMailboxOwnerWithoutASessionCannotConfirmAnAccountSomeoneElseRegistered(): void
    {
        // The attacker registers the victim's address with their own password and holds the restricted session.
        $code = $this->register('victim@example.com');
        TestHelper::createUser($this->em, $this->hasher, 'other@example.com');
        $otherLogin = $this->post('/api/auth/login', ['email' => 'other@example.com', 'password' => 'password123']);

        // The victim only has the mailed code and no session.
        $this->assertSame(401, $this->post('/api/auth/verify-email', ['email' => 'victim@example.com', 'code' => $code])['status']);
        // Another user's session does not confirm the victim's account with the victim's code.
        $r = $this->post('/api/auth/verify-email', ['email' => 'victim@example.com', 'code' => $code], 'Bearer '.$otherLogin['body']['access_token']);
        $this->assertSame(422, $r['status']);
        $this->assertSame('invalid_verification_code', $r['body']['code']);
        $this->assertFalse($this->user('victim@example.com')->isEmailVerified());
    }
}
