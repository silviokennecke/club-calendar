<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\OAuthAccount;
use App\Entity\Passkey;
use App\Entity\User;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\FakeOAuth2Client;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * SSO flow with faked provider clients: state/CSRF protection and the account-linking policy.
 */
class OAuthTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const string API = 'https://localhost';

    private static KernelBrowser $client;
    private static string $frontendUrl;
    private EntityManagerInterface $em;
    /** @var array<string, FakeOAuth2Client> */
    private static array $providers = [];

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        self::$client->disableReboot();
        self::$frontendUrl = rtrim((string) $_ENV['FRONTEND_URL'], '/');
        foreach (['google', 'microsoft', 'apple'] as $id) {
            self::$providers[$id] = new FakeOAuth2Client();
            static::getContainer()->set("knpu.oauth2.client.$id", self::$providers[$id]);
        }
    }

    protected function setUp(): void
    {
        $container = static::getContainer();
        $this->em = $container->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        self::$client->getCookieJar()->clear();
        foreach (self::$providers as $fake) {
            $fake->claims = [];
            $fake->fetchUserCalls = 0;
        }
    }

    protected function tearDown(): void
    {
        // Keep the kernel (and the replaced clients) alive across requests.
    }

    // --- helpers ---

    /** Starts the flow in the test browser (stores the state cookie) and returns the state. */
    private function start(string $provider): string
    {
        self::$client->request('GET', self::API."/api/auth/oauth/$provider");
        $response = self::$client->getResponse();
        $this->assertSame(302, $response->getStatusCode());
        parse_str((string) parse_url((string) $response->headers->get('Location'), \PHP_URL_QUERY), $query);

        return (string) ($query['state'] ?? '');
    }

    /** @return array<string, string> query of the redirect to the frontend */
    private function returnFrom(string $provider, ?string $state, array $claims): array
    {
        self::$providers[$provider]->claims = $claims;
        $query = ['code' => 'auth-code'] + (null === $state ? [] : ['state' => $state]);
        self::$client->request('GET', self::API."/api/auth/oauth/$provider/callback?".http_build_query($query));
        $response = self::$client->getResponse();
        $this->assertSame(302, $response->getStatusCode());
        $location = (string) $response->headers->get('Location');
        $this->assertStringStartsWith(self::$frontendUrl.'/auth/callback?', $location);
        parse_str((string) parse_url($location, \PHP_URL_QUERY), $result);

        return $result;
    }

    private function signIn(string $provider, array $claims): array
    {
        return $this->returnFrom($provider, $this->start($provider), $claims);
    }

    private static function google(string $email, bool $verified = true, string $sub = 'google-1'): array
    {
        return ['sub' => $sub, 'email' => $email, 'email_verified' => $verified, 'name' => 'Google User'];
    }

    private static function microsoft(string $email, string $sub = 'ms-1'): array
    {
        return ['sub' => $sub, 'email' => $email, 'name' => 'MS User'];
    }

    private function user(string $email): ?User
    {
        $this->em->clear();

        return $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
    }

    private function assertSignedIn(array $result): void
    {
        $this->assertArrayNotHasKey('error', $result);
        $this->assertNotEmpty($result['token'] ?? null);
        $this->assertNotEmpty($result['refresh_token'] ?? null);
    }

    private function assertFailed(string $code, array $result, string $message = ''): void
    {
        $this->assertSame(['error' => $code], $result, $message);
    }

    // --- state / CSRF ---

    public function testStartIssuesStateAndBindsItToTheBrowser(): void
    {
        $state = $this->start('google');
        $this->assertNotSame('', $state);
        $cookie = self::$client->getCookieJar()->get('oauth_state_nonce', '/api/auth/oauth', 'localhost');
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertTrue($cookie->isSecure());
    }

    public function testValidStateSignsInAndSendsTokensOnlyToTheFrontend(): void
    {
        $result = $this->signIn('google', self::google('new@example.com'));
        $this->assertSignedIn($result);
        $this->assertSame(['token', 'refresh_token'], array_keys($result));
    }

    public function testMissingStateIsRejected(): void
    {
        $this->start('google');
        $this->assertFailed('invalid_state', $this->returnFrom('google', null, self::google('new@example.com')));
        $this->assertNull($this->user('new@example.com'));
        $this->assertSame(0, self::$providers['google']->fetchUserCalls);
    }

    public function testManipulatedStateIsRejected(): void
    {
        $state = $this->start('google');
        $state[5] = 'A' === $state[5] ? 'B' : 'A';
        $this->assertFailed('invalid_state', $this->returnFrom('google', $state, self::google('new@example.com')));
        $this->assertNull($this->user('new@example.com'));
    }

    public function testExpiredStateIsRejected(): void
    {
        self::mockTime();
        $state = $this->start('google');
        self::mockTime('+11 minutes');
        $this->assertFailed('invalid_state', $this->returnFrom('google', $state, self::google('new@example.com')));
        $this->assertNull($this->user('new@example.com'));
    }

    public function testStateOfAnotherProviderIsRejected(): void
    {
        $state = $this->start('microsoft');
        $this->assertFailed('invalid_state', $this->returnFrom('google', $state, self::google('new@example.com')));
        $this->assertNull($this->user('new@example.com'));
    }

    public function testCallbackFromAnotherBrowserIsRejected(): void
    {
        // Login CSRF: the attacker starts the flow, then lures the victim to the callback URL.
        $state = $this->start('google');
        self::$client->getCookieJar()->clear();
        $this->assertFailed('invalid_state', $this->returnFrom('google', $state, self::google('attacker@example.com')));
        $this->assertNull($this->user('attacker@example.com'));
    }

    public function testStateIsSingleUse(): void
    {
        $state = $this->start('google');
        $cookie = self::$client->getCookieJar()->get('oauth_state_nonce', '/api/auth/oauth', 'localhost');
        $this->assertSignedIn($this->returnFrom('google', $state, self::google('new@example.com')));

        self::$client->getCookieJar()->set($cookie);
        $this->assertFailed('invalid_state', $this->returnFrom('google', $state, self::google('new@example.com')));
    }

    // --- linking policy ---

    public function testVerifiedGoogleEmailLinksExistingVerifiedUser(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'alice@example.com');

        $this->assertSignedIn($this->signIn('google', self::google('alice@example.com')));
        $user = $this->user('alice@example.com');
        $this->assertCount(1, $user->getOauthAccounts());
        $this->assertNotNull($user->getPassword());
    }

    public function testUnverifiedGoogleEmailDoesNotLinkExistingUser(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'alice@example.com');

        // Google vouches for its claim, and the claim says "not verified": the user can fix it at Google
        $this->assertFailed('email_unverified_at_provider', $this->signIn('google', self::google('alice@example.com', false)));
        $this->assertCount(0, $this->user('alice@example.com')->getOauthAccounts());
    }

    public function testUntrustedProviderOrDifferentAddressStillReportsAccountExists(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'alice@example.com');

        // Microsoft's claim is never trusted: no hint to "verify at the provider"
        $this->assertFailed('account_exists', $this->signIn('microsoft', self::microsoft('alice@example.com') + ['email_verified' => false]));
        // Verified at Google, but the address only matches by collation (ä = a): not linked, no verification hint
        $this->assertFailed('account_exists', $this->signIn('google', self::google('älice@example.com', true, 'google-2')));
        $this->assertCount(0, $this->user('alice@example.com')->getOauthAccounts());
    }

    public function testProviderErrorsHaveTheirOwnCodes(): void
    {
        foreach (['access_denied' => 'provider_denied', 'server_error' => 'provider_error', 'temporarily_unavailable' => 'provider_error'] as $error => $code) {
            $state = $this->start('google');
            self::$client->request('GET', self::API.'/api/auth/oauth/google/callback?'.http_build_query(['error' => $error, 'state' => $state]));
            $location = (string) self::$client->getResponse()->headers->get('Location');
            parse_str((string) parse_url($location, \PHP_URL_QUERY), $result);
            $this->assertSame(['error' => $code], $result, $error);
        }
        // The profile was never requested
        $this->assertSame(0, self::$providers['google']->fetchUserCalls);
        // Without a valid state the state error wins (a forged callback learns nothing else)
        self::$client->getCookieJar()->clear();
        self::$client->request('GET', self::API.'/api/auth/oauth/google/callback?error=access_denied&state=forged');
        parse_str((string) parse_url((string) self::$client->getResponse()->headers->get('Location'), \PHP_URL_QUERY), $result);
        $this->assertSame(['error' => 'invalid_state'], $result);
    }

    public function testMicrosoftNeverLinksExistingUserEvenWithAnEmailVerifiedClaim(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'alice@example.com');

        $claims = self::microsoft('alice@example.com') + ['email_verified' => true];
        $this->assertFailed('account_exists', $this->signIn('microsoft', $claims));
        $this->assertCount(0, $this->user('alice@example.com')->getOauthAccounts());
    }

    public function testNewMicrosoftUserIsNotMarkedEmailVerified(): void
    {
        $this->assertSignedIn($this->signIn('microsoft', self::microsoft('ms@example.com')));
        $user = $this->user('ms@example.com');
        $this->assertFalse($user->isEmailVerified());
        $this->assertCount(1, $user->getOauthAccounts());

        // The provider account keeps working.
        $this->assertSignedIn($this->signIn('microsoft', self::microsoft('ms@example.com')));
    }

    public function testNewGoogleUserIsMarkedVerifiedOnlyWithTheClaim(): void
    {
        $this->assertSignedIn($this->signIn('google', self::google('verified@example.com')));
        $this->assertTrue($this->user('verified@example.com')->isEmailVerified());

        $this->assertSignedIn($this->signIn('google', self::google('unverified@example.com', false, 'google-2')));
        $this->assertFalse($this->user('unverified@example.com')->isEmailVerified());
    }

    public function testPreRegisteredUnverifiedAccountCannotHijackTheVerifiedOwner(): void
    {
        // Someone registered with the owner's address but never confirmed it, and set their own password.
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'owner@example.com', 'attacker-pass', false);

        $this->assertSignedIn($this->signIn('google', self::google('owner@example.com')));
        $user = $this->user('owner@example.com');
        $this->assertTrue($user->isEmailVerified());
        $this->assertNull($user->getPassword());

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'owner@example.com', 'password' => 'attacker-pass',
        ]);
        $this->assertSame(401, $r['status']);
    }

    public function testUnverifiedSsoAccountCannotKeepAccessAfterTheVerifiedOwnerSignsIn(): void
    {
        // An attacker signs up via Microsoft with the owner's address (not verified) and adds a passkey.
        $this->assertSignedIn($this->signIn('microsoft', self::microsoft('owner@example.com', 'ms-attacker')));
        $user = $this->user('owner@example.com');
        $passkey = (new Passkey())->setId('attacker-key')->setUser($user)->setCredentialId('Y3JlZA==')->setPublicKey('x');
        $this->em->persist($passkey);
        $this->em->flush();

        $this->assertSignedIn($this->signIn('google', self::google('owner@example.com')));
        $user = $this->user('owner@example.com');
        $this->assertSame(['google'], $user->getOauthAccounts()->map(fn (OAuthAccount $a) => $a->getProvider())->getValues());
        $this->assertCount(0, $user->getPasskeys());
        $this->assertTrue($user->isEmailVerified());

        // The attacker's Microsoft login no longer reaches the account.
        $this->assertFailed('account_exists', $this->signIn('microsoft', self::microsoft('owner@example.com', 'ms-attacker')));
    }

    public function testKnownProviderAccountSignsIn(): void
    {
        $this->assertSignedIn($this->signIn('google', self::google('alice@example.com')));
        $this->assertSignedIn($this->signIn('google', self::google('alice@example.com')));
        $this->em->clear();
        $this->assertSame(1, $this->em->getRepository(User::class)->count([]));
    }

    public function testPruneKeepsUnverifiedSsoUsers(): void
    {
        $this->assertSignedIn($this->signIn('microsoft', self::microsoft('ms@example.com')));
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'stale@example.com', 'password123', false);
        $this->em->getConnection()->executeStatement("UPDATE `user` SET created_at = '2020-01-01 00:00:00'");

        $tester = new CommandTester((new Application(self::$client->getKernel()))->find('app:prune-unverified-users'));
        $tester->execute([]);

        $this->assertNotNull($this->user('ms@example.com'));
        $this->assertNull($this->user('stale@example.com'));
    }

    // --- adversarial ---

    public function testStateCookieAttributes(): void
    {
        self::$client->request('GET', self::API.'/api/auth/oauth/google');
        $cookies = self::$client->getResponse()->headers->getCookies();
        $this->assertCount(1, $cookies);
        $cookie = $cookies[0];
        $this->assertSame('oauth_state_nonce', $cookie->getName());
        $this->assertSame('/api/auth/oauth', $cookie->getPath());
        $this->assertNull($cookie->getDomain());
        $this->assertTrue($cookie->isSecure());
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('none', $cookie->getSameSite());
        $this->assertLessThanOrEqual(time() + 600, $cookie->getExpiresTime());
    }

    public function testAttackerStateFailsEvenWhenTheVictimHasAFlowOfTheirOwn(): void
    {
        // Attacker's browser
        $attackerState = $this->start('google');
        // Victim's browser has started its own flow (own cookie), then follows the attacker's callback link.
        self::$client->getCookieJar()->clear();
        $this->start('google');
        $this->assertFailed('invalid_state', $this->returnFrom('google', $attackerState, self::google('attacker@example.com')));
        $this->assertNull($this->user('attacker@example.com'));
    }

    public function testStateTokenFromAnotherPurposeIsRejected(): void
    {
        // A WebAuthn challenge token is signed with the same APP_SECRET but must not pass as OAuth state.
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/webauthn/authenticate/options');
        $this->start('google');
        $this->assertFailed('invalid_state', $this->returnFrom('google', $r['body']['challengeToken'], self::google('new@example.com')));
    }

    public function testUnknownProviderIsRejectedWithoutRedirect(): void
    {
        self::$client->request('GET', self::API.'/api/auth/oauth/evil');
        $this->assertSame(404, self::$client->getResponse()->getStatusCode());
        $this->assertSame('unknown_provider', json_decode((string) self::$client->getResponse()->getContent(), true)['code'] ?? null);
        $this->assertNull(self::$client->getResponse()->headers->get('Location'));

        self::$client->request('GET', self::API.'/api/auth/oauth/evil/callback?state=x&code=y');
        $location = (string) self::$client->getResponse()->headers->get('Location');
        $this->assertSame(self::$frontendUrl.'/auth/callback?error=invalid_state', $location);
    }

    public function testProviderErrorsDoNotLeakDetails(): void
    {
        $state = $this->start('google');
        self::$providers['google']->claims = ['sub' => ''];
        $this->assertFailed('email_missing', $this->returnFrom('google', $state, ['sub' => 'g-1']));
        $state = $this->start('google');
        $this->assertFailed('email_missing', $this->returnFrom('google', $state, ['email' => 'x@example.com', 'email_verified' => true]));
    }

    public function testOnlyABooleanOrStringTrueCountsAsVerified(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'alice@example.com');
        $i = 0;
        foreach (['false', 0, 1, '1', 'TRUE', 'yes', [], null] as $claim) {
            $claims = ['sub' => 'g-'.++$i, 'email' => 'alice@example.com', 'email_verified' => $claim];
            $this->assertFailed('email_unverified_at_provider', $this->signIn('google', $claims), var_export($claim, true));
        }
        $this->assertFailed('email_unverified_at_provider', $this->signIn('google', ['sub' => 'g-x', 'email' => 'alice@example.com']));
        $this->assertCount(0, $this->user('alice@example.com')->getOauthAccounts());

        // Apple sends the claim as a string.
        $this->assertSignedIn($this->signIn('apple', ['sub' => 'apple-1', 'email' => 'alice@example.com', 'email_verified' => 'true']));
        $this->assertCount(1, $this->user('alice@example.com')->getOauthAccounts());
    }

    public function testLookalikeAddressesNeverLinkToAnExistingAccount(): void
    {
        // The column collation treats these as equal to alice@gmail.com.
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'alice@gmail.com');
        $i = 0;
        foreach (['alice@gmäil.com', "\u{FF41}lice@gmail.com", 'alice@gmail.com '] as $email) {
            $result = $this->signIn('google', self::google($email, true, 'g-'.++$i));
            $this->assertArrayNotHasKey('token', $result, $email);
        }
        // Not collation-equal: becomes a separate account.
        $this->assertSignedIn($this->signIn('google', self::google('alıce@gmail.com', true, 'g-dotless')));
        $this->em->clear();
        $alice = $this->user('alice@gmail.com');
        $this->assertCount(0, $alice->getOauthAccounts());
        $this->assertNotNull($alice->getPassword());

        // Letter case alone is the same address.
        $this->assertSignedIn($this->signIn('google', self::google('Alice@GMAIL.com', true, 'g-case')));
        $this->assertCount(1, $this->user('alice@gmail.com')->getOauthAccounts());
    }

    public function testMicrosoftCannotBypassTheConflictWithLetterCase(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'alice@example.com');
        $this->assertFailed('account_exists', $this->signIn('microsoft', self::microsoft('ALICE@Example.COM')));
        $this->em->clear();
        $this->assertSame(1, $this->em->getRepository(User::class)->count([]));
    }

    public function testVerifiedTakeoverRemovesPendingConfirmationLinks(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        $user = TestHelper::createUser($this->em, $hasher, 'owner@example.com', 'attacker-pass', false);
        $verification = (new \App\Entity\EmailVerification())->setUser($user)->setTokenHash(hash('sha256', random_bytes(16)));
        $this->em->persist($verification);
        $this->em->flush();

        $this->assertSignedIn($this->signIn('google', self::google('owner@example.com')));
        $this->em->clear();
        $this->assertSame(0, $this->em->getRepository(\App\Entity\EmailVerification::class)->count([]));
    }

    public function testVerifiedSsoNeverStripsAVerifiedAccount(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        $user = TestHelper::createUser($this->em, $hasher, 'alice@example.com');
        $passkey = (new Passkey())->setId('alice-key')->setUser($user)->setCredentialId('YWxpY2U=')->setPublicKey('x');
        $this->em->persist($passkey);
        $this->em->flush();
        $this->assertSignedIn($this->signIn('microsoft', self::microsoft('other@example.com')));

        $this->assertSignedIn($this->signIn('google', self::google('alice@example.com')));
        $alice = $this->user('alice@example.com');
        $this->assertNotNull($alice->getPassword());
        $this->assertCount(1, $alice->getPasskeys());
    }

    public function testPruneNeverDeletesVerifiedUsers(): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'verified@example.com');
        TestHelper::createUser($this->em, $hasher, 'fresh@example.com', 'password123', false);
        TestHelper::createUser($this->em, $hasher, 'old@example.com', 'password123', false);
        $this->em->getConnection()->executeStatement("UPDATE `user` SET created_at = '2020-01-01 00:00:00' WHERE email <> 'fresh@example.com'");

        $tester = new CommandTester((new Application(self::$client->getKernel()))->find('app:prune-unverified-users'));
        $tester->execute([]);

        $this->assertNotNull($this->user('verified@example.com'));
        $this->assertNotNull($this->user('fresh@example.com'));
        $this->assertNull($this->user('old@example.com'));
    }
}
