<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Passkey;
use App\Entity\User;
use App\Service\AuthService;
use App\Service\EmailVerificationService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\FakeOAuth2Client;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Lexik\Bundle\JWTAuthenticationBundle\Encoder\JWTEncoderInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Sessions (access + refresh tokens) issued before credentials were taken away must stop working:
 * SSO takeover of an unconfirmed account, confirmation of the address by its owner, account deletion.
 */
class SessionInvalidationTest extends WebTestCase
{
    private const string API = 'https://localhost';

    private static KernelBrowser $client;
    private EntityManagerInterface $em;
    /** @var array<string, FakeOAuth2Client> */
    private static array $providers = [];

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        self::$client->disableReboot();
        foreach (['google', 'microsoft', 'apple'] as $id) {
            self::$providers[$id] = new FakeOAuth2Client();
            static::getContainer()->set("knpu.oauth2.client.$id", self::$providers[$id]);
        }
    }

    protected function setUp(): void
    {
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        self::$client->getCookieJar()->clear();
    }

    protected function tearDown(): void
    {
        // Keep the kernel (and the replaced clients) alive across requests.
    }

    // --- helpers ---

    /** @return array{token: string, refresh_token: string} */
    private function signIn(string $provider, array $claims, bool $expectVerificationRequired = false): array
    {
        self::$client->request('GET', self::API."/api/auth/oauth/$provider");
        parse_str((string) parse_url((string) self::$client->getResponse()->headers->get('Location'), \PHP_URL_QUERY), $start);
        self::$providers[$provider]->claims = $claims;
        self::$client->request('GET', self::API."/api/auth/oauth/$provider/callback?".http_build_query([
            'code' => 'auth-code', 'state' => (string) ($start['state'] ?? ''),
        ]));
        $location = (string) self::$client->getResponse()->headers->get('Location');
        parse_str((string) parse_url($location, \PHP_URL_QUERY), $result);
        if ($expectVerificationRequired) {
            $this->assertSame('email_verification_required', $result['error'] ?? null, $location);

            return $result;
        }
        $this->assertArrayNotHasKey('error', $result, $location);
        $this->assertArrayNotHasKey('token', $result, 'no token in the redirect URL');
        $this->assertNotEmpty($result['code'] ?? null, $location);
        // The frontend redeems the one-time code for the session.
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'one_time_token', 'token' => $result['code']]);
        $this->assertSame(200, self::$client->getResponse()->getStatusCode(), (string) self::$client->getResponse()->getContent());
        $tokens = json_decode((string) self::$client->getResponse()->getContent(), true);

        return ['token' => $tokens['access_token'], 'refresh_token' => $tokens['refresh_token']];
    }

    /**
     * An unverified account created by a Microsoft login (no session is issued by the login itself, so the
     * tokens that someone could have held, e.g. from before this rule, are issued directly).
     *
     * @return array{token: string, refresh_token: string}
     */
    private function unverifiedMicrosoftSession(string $email): array
    {
        $this->signIn('microsoft', self::microsoft($email), true);
        $tokens = $this->tokens()->tokenResponse($this->user($email));

        return ['token' => $tokens['access_token'], 'refresh_token' => $tokens['refresh_token']];
    }

    private static function google(string $email, string $sub = 'google-owner'): array
    {
        return ['sub' => $sub, 'email' => $email, 'email_verified' => true, 'name' => 'Owner'];
    }

    private static function microsoft(string $email, string $sub = 'ms-attacker'): array
    {
        return ['sub' => $sub, 'email' => $email, 'name' => 'Attacker'];
    }

    private function me(string $accessToken): int
    {
        return TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], 'Bearer '.$accessToken)['status'];
    }

    /** @return array{0: int, 1: mixed} */
    private function refresh(string $refreshToken): array
    {
        self::$client->request('POST', '/api/auth/token', [
            'grant_type' => 'refresh_token',
            'refresh_token' => $refreshToken,
        ]);
        $response = self::$client->getResponse();

        return [$response->getStatusCode(), json_decode((string) $response->getContent(), true)];
    }

    /** The owner enters a code for the address (issued directly: the mail is covered elsewhere). */
    private function confirm(string $email): void
    {
        $service = static::getContainer()->get(EmailVerificationService::class);
        $service->verify($email, $service->issueCode($this->user($email)));
    }

    private function user(string $email): User
    {
        $this->em->clear();
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        $this->assertNotNull($user);

        return $user;
    }

    private function tokens(): TokenService
    {
        return static::getContainer()->get(TokenService::class);
    }

    private static function iat(string $jwt): int
    {
        $payload = json_decode((string) base64_decode(strtr(explode('.', $jwt)[1], '-_', '+/')), true);

        return (int) $payload['iat'];
    }

    // --- problem A: SSO takeover of an unconfirmed account ---

    public function testAttackerSessionEndsWhenTheVerifiedOwnerTakesOverTheAccount(): void
    {
        $attacker = $this->unverifiedMicrosoftSession('owner@example.com');
        $this->assertSame(200, $this->me($attacker['token']));
        // Tokens of an unconfirmed account (data from before the rule) cannot be refreshed any more.
        $this->assertSame(401, $this->refresh($attacker['refresh_token'])[0]);

        $owner = $this->signIn('google', self::google('owner@example.com'));

        $this->assertSame(401, $this->refresh($attacker['refresh_token'])[0], 'attacker refresh token');
        $this->assertSame(401, $this->me($attacker['token']), 'attacker access token');

        // The owner's tokens, issued by the takeover itself, are valid and keep working after a refresh.
        $this->assertSame(200, $this->me($owner['token']));
        [$status, $ownerRefreshed] = $this->refresh($owner['refresh_token']);
        $this->assertSame(200, $status);
        $this->assertSame(200, $this->me($ownerRefreshed['access_token']));
        $this->assertSame(200, $this->refresh($ownerRefreshed['refresh_token'])[0]);
        // A later Google login of the owner (known account, no cleanup) does not end the owner's sessions.
        $again = $this->signIn('google', self::google('owner@example.com'));
        $this->assertSame(200, $this->me($owner['token']));
        $this->assertSame(200, $this->me($again['token']));
    }

    public function testTokensOfThePreRegistrantEndWithTheTakeover(): void
    {
        // Pre-registration with the owner's address; tokens obtained some other way (e.g. issued before the
        // e-mail check existed) must not survive the owner's verified sign-in either.
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        $squatter = TestHelper::createUser($this->em, $hasher, 'owner@example.com', 'squatter-pass', false);
        $access = $this->tokens()->createAccessToken($squatter);
        $refresh = $this->tokens()->createRefreshToken($squatter);

        $owner = $this->signIn('google', self::google('owner@example.com'));

        $this->assertSame(401, $this->me($access));
        $this->assertSame(401, $this->refresh($refresh)[0]);
        $this->assertSame(200, $this->me($owner['token']));
    }

    /**
     * iat has one-second resolution. The cut-off is a counter on the user (token version), not a time:
     * a token issued in the same second before the invalidation is rejected, one issued after it is valid.
     */
    public function testTokensFromTheSameSecondAreDecidedByIssueOrderNotByTime(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        for ($attempt = 0; $attempt < 5; ++$attempt) {
            DatabaseResetter::reset($this->em);
            $user = TestHelper::createUser($this->em, $hasher, 'owner@example.com', 'squatter-pass', false);
            $before = $this->tokens()->createAccessToken($user);
            $beforeRefresh = $this->tokens()->createRefreshToken($user);
            // The verified owner takes over the account; the takeover issues the owner's tokens.
            $owner = static::getContainer()->get(AuthService::class)
                ->findOrCreateOAuthUser('google', 'google-owner', 'owner@example.com', 'Owner', true);
            $after = $this->tokens()->createAccessToken($owner);
            $afterRefresh = $this->tokens()->createRefreshToken($owner);
            if (self::iat($before) === self::iat($after)) {
                break;
            }
        }
        $this->assertSame(self::iat($before), self::iat($after), 'could not issue both tokens within one second');
        $this->em->clear();

        $this->assertSame(401, $this->me($before));
        $this->assertSame(401, $this->refresh($beforeRefresh)[0]);
        $this->assertSame(200, $this->me($after));
        $this->assertSame(200, $this->refresh($afterRefresh)[0]);
    }

    public function testOtherUsersKeepTheirSessions(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'bob@example.com');
        $login = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'bob@example.com', 'password' => 'password123',
        ]);
        $this->assertSame(200, $login['status']);
        $carol = $this->signIn('google', self::google('carol@example.com', 'google-carol'));

        $this->unverifiedMicrosoftSession('owner@example.com');
        $this->signIn('google', self::google('owner@example.com'));

        $this->assertSame(200, $this->me($login['body']['access_token']));
        $this->assertSame(200, $this->refresh($login['body']['refresh_token'])[0]);
        $this->assertSame(200, $this->me($carol['token']));
        $this->assertSame(200, $this->refresh($carol['refresh_token'])[0]);
    }

    /** Tokens issued before this change carry no version claim: they stay valid until something is revoked. */
    public function testTokensWithoutVersionClaimStayValidUntilTheFirstInvalidation(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        $user = TestHelper::createUser($this->em, $hasher, 'legacy@example.com', 'password123', false);
        $access = static::getContainer()->get(JWTEncoderInterface::class)->encode([
            'email' => 'legacy@example.com', 'roles' => ['ROLE_USER'], 'exp' => time() + 900,
        ]);
        $header = base64_encode((string) json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $body = base64_encode((string) json_encode(['sub' => $user->getId(), 'exp' => time() + 3600, 'type' => 'refresh']));
        $refresh = "$header.$body.".base64_encode(hash_hmac('sha256', "$header.$body", (string) $_ENV['JWT_REFRESH_SECRET'], true));

        $this->assertSame(200, $this->me($access));
        // Refreshing is refused while the address is unconfirmed.
        $this->assertSame(401, $this->refresh($refresh)[0]);

        $this->signIn('google', self::google('legacy@example.com'));
        $this->assertSame(401, $this->me($access));
        $this->assertSame(401, $this->refresh($refresh)[0]);
    }

    public function testInvalidationDoesNotDependOnTheServerTimezone(): void
    {
        $previous = date_default_timezone_get();
        try {
            foreach (['Pacific/Kiritimati', 'Pacific/Pago_Pago'] as $zone) {
                DatabaseResetter::reset($this->em);
                date_default_timezone_set($zone);
                $attacker = $this->unverifiedMicrosoftSession('owner@example.com');
                $owner = $this->signIn('google', self::google('owner@example.com'));

                $this->assertSame(401, $this->me($attacker['token']), $zone);
                $this->assertSame(401, $this->refresh($attacker['refresh_token'])[0], $zone);
                $this->assertSame(200, $this->me($owner['token']), $zone);
                $this->assertSame(200, $this->refresh($owner['refresh_token'])[0], $zone);
            }
        } finally {
            date_default_timezone_set($previous);
        }
    }

    // --- problem B: the owner confirms the address with the code ---

    public function testConfirmingTheAddressEndsTheUnverifiedSsoLinksAndSessions(): void
    {
        // The attacker signs up via Microsoft with the owner's address and adds a passkey.
        $attacker = $this->unverifiedMicrosoftSession('owner@example.com');
        $user = $this->user('owner@example.com');
        $this->em->persist((new Passkey())->setId('attacker-key')->setUser($user)->setCredentialId('YXR0YWNrZXI=')->setPublicKey('x'));
        $this->em->flush();

        // The owner enters the code from the mail.
        $this->confirm('owner@example.com');

        $user = $this->user('owner@example.com');
        $this->assertTrue($user->isEmailVerified());
        // The passkey was added in a session of someone who did not prove the address: gone, sessions end.
        $this->assertCount(0, $user->getPasskeys());
        $this->assertSame(401, $this->me($attacker['token']));
        $this->assertSame(401, $this->refresh($attacker['refresh_token'])[0]);

        // A passwordless account created by the SSO login keeps its provider link: the mailbox owner's
        // confirmation is what lets that provider account in (see AuthService::findOrCreateOAuthUser).
        $this->assertCount(1, $user->getOauthAccounts());
        $this->assertSame(200, $this->me($this->signIn('microsoft', self::microsoft('owner@example.com'))['token']));
    }

    public function testConfirmingALocalRegistrationKeepsThePassword(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/register', [
            'name' => 'Dana', 'email' => 'dana@example.com', 'password' => 'password123',
        ]);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->confirm('dana@example.com');

        $login = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'dana@example.com', 'password' => 'password123',
        ]);
        $this->assertSame(200, $login['status'], $login['content']);
        $this->assertSame(200, $this->me($login['body']['access_token']));
        $this->assertSame(200, $this->refresh($login['body']['refresh_token'])[0]);
    }

    /**
     * Known residual risk (security audit, pre-hijacking): someone registers locally with the
     * owner's address and an own password; the owner clicks the confirmation link. The confirmation ends
     * sessions, but the registrant never had one (password login needs a confirmed address) and still knows
     * the password afterwards; a later Google login of the owner does not remove it (address is confirmed).
     * Fixing this needs a feature (password reset / set password on confirmation), not part of this fix.
     */
    public function testPreRegisteredPasswordStillWorksAfterTheOwnerConfirms(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/register', [
            'name' => 'Squatter', 'email' => 'owner@example.com', 'password' => 'squatter-pass',
        ]);
        $this->assertSame(201, $r['status'], $r['content']);
        $before = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'owner@example.com', 'password' => 'squatter-pass',
        ]);
        $this->assertSame(403, $before['status'], 'no session before the confirmation');

        $this->confirm('owner@example.com');
        $owner = $this->signIn('google', self::google('owner@example.com'));
        $this->assertSame(200, $this->me($owner['token']));

        $after = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'owner@example.com', 'password' => 'squatter-pass',
        ]);
        $this->assertSame(200, $after['status'], 'residual risk: the registrant password stays valid');
        // Both sessions are valid at the same time: nothing was invalidated after the confirmation.
        $this->assertSame(200, $this->me($owner['token']));
        $this->assertSame(200, $this->me($after['body']['access_token']));
    }

    public function testParallelSessionsOfTheSameUserStayValid(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'bob@example.com');
        $credentials = ['email' => 'bob@example.com', 'password' => 'password123'];
        $first = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', $credentials)['body'];
        $second = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', $credentials)['body'];
        // Bob's own (verified) Google login links to his confirmed account without cleanup.
        $sso = $this->signIn('google', self::google('bob@example.com', 'google-bob'));

        [$status, $firstRefreshed] = $this->refresh($first['refresh_token']);
        $this->assertSame(200, $status);
        foreach ([$first['access_token'], $second['access_token'], $sso['token'], $firstRefreshed['access_token']] as $i => $token) {
            $this->assertSame(200, $this->me($token), "access token $i");
        }
        foreach ([$first['refresh_token'], $second['refresh_token'], $sso['refresh_token'], $firstRefreshed['refresh_token']] as $i => $token) {
            $this->assertSame(200, $this->refresh($token)[0], "refresh token $i");
        }
        $this->assertSame(0, $this->user('bob@example.com')->getTokenVersion());
    }

    // --- account deletion ---

    public function testTokensOfADeletedAccountDoNotReachANewAccountWithTheSameAddress(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        $old = TestHelper::createUser($this->em, $hasher, 'eve@example.com');
        $access = $this->tokens()->createAccessToken($old);
        $refresh = $this->tokens()->createRefreshToken($old);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/me', [], 'Bearer '.$access)['status']);

        $this->assertSame(401, $this->me($access));
        $this->assertSame(401, $this->refresh($refresh)[0]);

        TestHelper::createUser($this->em, $hasher, 'eve@example.com');
        $this->assertSame(401, $this->me($access), 'old access token must not open the new account');
        $this->assertSame(401, $this->refresh($refresh)[0]);
    }
}
