<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\OAuthAccount;
use App\Entity\Passkey;
use App\Entity\User;
use App\Security\SignedTokenService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\FakeOAuth2Client;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Linking an SSO account to the signed-in user and unlinking it: link and sign-in states are not
 * interchangeable, foreign provider accounts cannot be taken over, the last sign-in method stays.
 */
class OAuthLinkTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const string API = 'https://localhost';

    private static KernelBrowser $client;
    private static string $frontendUrl;
    private EntityManagerInterface $em;
    private UserPasswordHasherInterface $hasher;
    private TokenService $tokens;
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
        $this->hasher = $container->get(UserPasswordHasherInterface::class);
        $this->tokens = $container->get(TokenService::class);
        DatabaseResetter::reset($this->em);
        self::$client->getCookieJar()->clear();
        foreach (self::$providers as $fake) {
            $fake->claims = [];
            $fake->tokenNonce = null;
            $fake->omitNonce = false;
            $fake->fetchUserCalls = 0;
        }
    }

    protected function tearDown(): void
    {
        // Keep the kernel (and the replaced clients) alive across requests.
    }

    // --- helpers ---

    /** @var array<string, string> step-up token by Authorization header */
    private array $stepUps = [];

    /** @var array<string, string> Authorization header by user id and token version */
    private array $sessions = [];

    /** One session per user (and session version) with a step-up token, as the profile page has after confirming. */
    private function auth(User $user): string
    {
        $key = $user->getId().'#'.$user->getTokenVersion();
        if (!isset($this->sessions[$key])) {
            $auth = TestHelper::sessionHeader($user, $this->tokens);
            $conn = $this->em->getConnection();
            $row = $conn->fetchAssociative('SELECT password, mfa_enforced FROM user WHERE id = ?', [$user->getId()]);
            $conn->executeStatement('UPDATE user SET password = ?, mfa_enforced = 0 WHERE id = ?', [$this->hasher->hashPassword($user, 'password123'), $user->getId()]);
            if ($this->em->contains($user)) {
                $this->em->refresh($user);
            }
            try {
                $this->stepUps[$auth] = TestHelper::stepUp(self::$client, $auth);
            } finally {
                $conn->executeStatement('UPDATE user SET password = ?, mfa_enforced = ? WHERE id = ?', [$row['password'], $row['mfa_enforced'], $user->getId()]);
                if ($this->em->contains($user)) {
                    $this->em->refresh($user);
                }
            }
            $this->sessions[$key] = $auth;
        }

        return $this->sessions[$key];
    }

    private function stepUpOf(string $auth): ?string
    {
        return $this->stepUps[$auth] ?? null;
    }

    private function linkStart(User $user, string $provider): array
    {
        return TestHelper::jsonRequest(self::$client, 'POST', self::API."/api/auth/oauth/$provider/link-start", [], $this->auth($user), $this->stepUpOf($this->auth($user)));
    }

    /** POST link-start, then open the returned URL in the browser; returns the ticket. */
    private function ticket(User $user, string $provider): string
    {
        $r = $this->linkStart($user, $provider);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['url'], array_keys($r['body']));
        $url = $r['body']['url'];
        $this->assertStringStartsWith(rtrim((string) $_ENV['BACKEND_URL'], '/')."/api/auth/oauth/$provider/link?ticket=", $url);
        parse_str((string) parse_url($url, \PHP_URL_QUERY), $query);

        return (string) $query['ticket'];
    }

    /** Opens the ticket URL; returns the Location of the redirect. */
    private function openTicket(string $provider, string $ticket): string
    {
        self::$client->request('GET', self::API."/api/auth/oauth/$provider/link?".http_build_query(['ticket' => $ticket]));
        $response = self::$client->getResponse();
        $this->assertSame(302, $response->getStatusCode());

        return (string) $response->headers->get('Location');
    }

    /** Full start of a link flow: returns the link state sent to the provider. */
    private function startLink(User $user, string $provider): string
    {
        $location = $this->openTicket($provider, $this->ticket($user, $provider));
        $this->assertStringStartsWith('https://provider.example/authorize?', $location);
        parse_str((string) parse_url($location, \PHP_URL_QUERY), $query);

        return (string) $query['state'];
    }

    /** Callback with claims; returns the full Location of the redirect to the frontend. */
    private function returnFrom(string $provider, string $state, array $claims, array $extra = []): string
    {
        self::$providers[$provider]->claims = $claims;
        self::$client->request('GET', self::API."/api/auth/oauth/$provider/callback?".http_build_query(['code' => 'auth-code', 'state' => $state] + $extra));
        $response = self::$client->getResponse();
        $this->assertSame(302, $response->getStatusCode());

        return (string) $response->headers->get('Location');
    }

    private function link(User $user, string $provider, array $claims): string
    {
        return $this->complete($user, $this->returnFrom($provider, $this->startLink($user, $provider), $claims));
    }

    /**
     * Second half of a link flow: a callback redirect with a proof is completed by the signed-in frontend
     * (POST link-complete with the user's JWT). Returns the profile URL the old one-step flow would have
     * shown (?linked= / ?link_error=), other redirects unchanged.
     */
    private function complete(User $user, string $location): string
    {
        parse_str((string) parse_url($location, \PHP_URL_QUERY), $query);
        if (!isset($query['link_proof'])) {
            return $location;
        }
        $this->assertSame(self::profile(['link_provider' => $query['link_provider'], 'link_proof' => $query['link_proof']]), $location);
        $r = $this->completeRequest((string) $query['link_provider'], (string) $query['link_proof'], $this->auth($user));

        return 204 === $r['status'] ? self::profile(['linked' => $query['link_provider']]) : self::profile(['link_error' => $r['body']['code'] ?? 'status-'.$r['status']]);
    }

    private function completeRequest(string $provider, string $proof, ?string $auth, ?string $stepUp = null): array
    {
        return null === $auth
            ? TestHelper::jsonRequest(self::$client, 'POST', self::API."/api/auth/oauth/$provider/link-complete", ['proof' => $proof])
            : TestHelper::jsonRequest(self::$client, 'POST', self::API."/api/auth/oauth/$provider/link-complete", ['proof' => $proof], $auth, $stepUp ?? $this->stepUpOf($auth));
    }

    /** Callback of a started link flow; returns the proof of the redirect to the profile. */
    private function proofFor(User $user, string $provider, string $sub): string
    {
        $location = $this->returnFrom($provider, $this->startLink($user, $provider), ['sub' => $sub]);
        parse_str((string) parse_url($location, \PHP_URL_QUERY), $query);
        $this->assertArrayHasKey('link_proof', $query, $location);

        return (string) $query['link_proof'];
    }

    private static function profile(array $query): string
    {
        return rtrim((string) $_ENV['FRONTEND_URL'], '/').'/profile?'.http_build_query($query);
    }

    /** @return list<array{provider: string, providerId: string, user: string}> */
    private function accounts(): array
    {
        $this->em->clear();

        return array_map(fn (OAuthAccount $a) => [
            'provider' => $a->getProvider(),
            'providerId' => $a->getProviderId(),
            'user' => $a->getUser()->getEmail(),
        ], $this->em->getRepository(OAuthAccount::class)->findAll());
    }

    private function createUser(string $email, bool $withPassword = true): User
    {
        $user = TestHelper::createUser($this->em, $this->hasher, $email);
        if (!$withPassword) {
            $user->setPassword(null);
            $this->em->flush();
        }

        return $user;
    }

    private function addAccount(User $user, string $provider, string $sub): void
    {
        $account = new OAuthAccount();
        $account->setUser($user)->setProvider($provider)->setProviderId($sub);
        $this->em->persist($account);
        $this->em->flush();
    }

    // --- link-start ---

    public function testLinkStartNeedsASessionAndAKnownProvider(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', self::API.'/api/auth/oauth/google/link-start');
        $this->assertSame(401, $r['status']);

        $user = $this->createUser('alice@example.com');
        $r = $this->linkStart($user, 'nope');
        $this->assertSame(404, $r['status']);
        $this->assertSame('unknown_provider', $r['body']['code']);
    }

    // --- step-up ---

    public function testLinkingAndUnlinkingNeedAStepUp(): void
    {
        $user = $this->createUser('alice@example.com');
        $this->addAccount($user, 'google', 'g-1');
        $plain = TestHelper::sessionHeader($user, $this->tokens);
        foreach ([
            ['POST', '/api/auth/oauth/google/link-start', []],
            ['POST', '/api/auth/oauth/google/link-complete', ['proof' => 'forged.proof']],
            ['DELETE', '/api/auth/oauth/google', []],
        ] as [$method, $uri, $body]) {
            $r = TestHelper::jsonRequest(self::$client, $method, self::API.$uri, $body, $plain);
            $this->assertSame(403, $r['status'], "$method $uri");
            $this->assertSame('step_up_required', $r['body']['code'], "$method $uri");
        }
        $this->assertCount(1, $this->accounts());
    }

    public function testStepUpExpiredDuringTheProviderDetourKeepsTheProofUsable(): void
    {
        self::mockTime('2026-10-13 09:00:00 UTC');
        $user = $this->createUser('alice@example.com');
        $auth = $this->auth($user);
        $oldToken = $this->stepUpOf($auth);

        self::mockTime('+8 minutes');
        $proof = $this->proofFor($user, 'google', 'g-1');
        self::mockTime('+3 minutes');
        $r = $this->completeRequest('google', $proof, $auth, $oldToken);
        $this->assertSame(403, $r['status']);
        $this->assertSame('step_up_required', $r['body']['code']);
        $this->assertSame([], $this->accounts());

        // The refused call did not use up the proof: confirm again and repeat.
        $this->assertSame(204, $this->completeRequest('google', $proof, $auth, TestHelper::stepUp(self::$client, $auth))['status']);
        $this->assertCount(1, $this->accounts());
    }

    // --- linking ---

    public function testLinkAttachesTheProviderAccountAndIssuesNoTokens(): void
    {
        $user = $this->createUser('alice@example.com');
        $state = $this->startLink($user, 'google');
        $cookie = self::$client->getCookieJar()->get('oauth_state_nonce', '/api/auth/oauth', 'localhost');
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());

        $redirect = $this->returnFrom('google', $state, ['sub' => 'g-1', 'email' => 'other-address@gmail.example', 'email_verified' => false]);
        $this->assertStringNotContainsString('token', $redirect);
        // Nothing is linked before the signed-in frontend completes the flow.
        $this->assertSame([], $this->accounts());
        $this->assertSame(self::profile(['linked' => 'google']), $this->complete($user, $redirect));
        $this->assertSame([['provider' => 'google', 'providerId' => 'g-1', 'user' => 'alice@example.com']], $this->accounts());

        // The linked account signs in to this user afterwards.
        $me = TestHelper::jsonRequest(self::$client, 'GET', self::API.'/api/auth/me', [], $this->auth($user));
        $this->assertSame([['provider' => 'google']], $me['body']['oauthAccounts']);
    }

    public function testLinkAuthorizeUrlCarriesTheNonce(): void
    {
        $user = $this->createUser('alice@example.com');
        foreach (['google', 'microsoft', 'apple'] as $provider) {
            $this->startLink($user, $provider);
            $this->assertGreaterThanOrEqual(43, strlen((string) self::$providers[$provider]->lastNonce));
        }
    }

    public function testLinkFailsWithoutOrWithAWrongIdTokenNonce(): void
    {
        $user = $this->createUser('alice@example.com');
        self::$providers['google']->omitNonce = true;
        $this->assertSame(self::profile(['link_error' => 'oauth_failed']), $this->returnFrom('google', $this->startLink($user, 'google'), ['sub' => 'g-1']));

        self::$providers['google']->omitNonce = false;
        self::$providers['google']->tokenNonce = 'wrong';
        $this->assertSame(self::profile(['link_error' => 'oauth_failed']), $this->returnFrom('google', $this->startLink($user, 'google'), ['sub' => 'g-1']));
        $this->assertSame([], $this->accounts());
    }

    public function testLinkFailsWithTheNonceOfAnotherFlow(): void
    {
        $user = $this->createUser('alice@example.com');
        $this->startLink($user, 'google');
        $nonceOfFlowA = (string) self::$providers['google']->lastNonce;
        $stateB = $this->startLink($user, 'google');
        self::$providers['google']->tokenNonce = $nonceOfFlowA;
        $this->assertSame(self::profile(['link_error' => 'oauth_failed']), $this->returnFrom('google', $stateB, ['sub' => 'g-1']));
        $this->assertSame([], $this->accounts());
    }

    public function testMicrosoftCanBeLinkedWhileSignedIn(): void
    {
        // The sign-in flow never links Microsoft to an existing account (untrusted e-mail claim); the
        // signed-in user can link it explicitly.
        $user = $this->createUser('alice@example.com');
        $this->assertSame(self::profile(['linked' => 'microsoft']), $this->link($user, 'microsoft', ['sub' => 'ms-1', 'email' => 'alice@example.com']));
        $this->assertSame('alice@example.com', $this->accounts()[0]['user']);
    }

    public function testLinkingTheSameAccountAgainIsIdempotent(): void
    {
        $user = $this->createUser('alice@example.com');
        $this->addAccount($user, 'google', 'g-1');
        $this->assertSame(self::profile(['linked' => 'google']), $this->link($user, 'google', ['sub' => 'g-1', 'email' => 'a@gmail.example']));
        $this->assertCount(1, $this->accounts());
    }

    public function testLinkingFromTheProfileWorksForAnMfaUserAndSendsOneNoticeAndEvent(): void
    {
        $user = $this->createUser('alice@example.com');
        $user->setMfaEnforced(true)->setLanguage('de');
        $this->em->flush();
        $this->assertSame(self::profile(['linked' => 'google']), $this->link($user, 'google', ['sub' => 'g-1', 'email' => 'a@gmail.example']));
        $this->assertCount(1, $this->accounts());

        $mails = array_values(array_filter($this->getMailerMessages(), fn ($m) => $m instanceof \Symfony\Component\Mime\Email));
        $this->assertCount(1, $mails);
        $this->assertSame('Eine Anmeldung über einen Anbieter wurde verknüpft', $mails[0]->getSubject());
        $this->assertStringContainsString('Google', (string) $mails[0]->getHtmlBody());
        $this->assertStringContainsString('/forgot-password', (string) $mails[0]->getHtmlBody());
        $row = static::getContainer()->get(\Doctrine\DBAL\Connection::class)->fetchAssociative("SELECT * FROM security_event WHERE type = 'sso_linked'");
        $this->assertSame('google', $row['provider']);
        $this->assertSame('sso', $row['method']);
        $this->assertSame(1, (int) $row['success']);

        // Linking the same account again is not a new link: no notice for that request, no second event.
        $this->link($user, 'google', ['sub' => 'g-1', 'email' => 'a@gmail.example']);
        $this->assertCount(0, array_filter($this->getMailerMessages(), fn ($m) => $m instanceof \Symfony\Component\Mime\Email));
        $this->assertSame(1, (int) static::getContainer()->get(\Doctrine\DBAL\Connection::class)->fetchOne("SELECT COUNT(*) FROM security_event WHERE type = 'sso_linked'"));
    }

    public function testProviderAccountOfAnotherUserCannotBeTakenOver(): void
    {
        $owner = $this->createUser('owner@example.com');
        $this->addAccount($owner, 'google', 'g-owner');
        $user = $this->createUser('alice@example.com');

        $location = $this->link($user, 'google', ['sub' => 'g-owner', 'email' => 'owner@example.com', 'email_verified' => true]);
        $this->assertSame(self::profile(['link_error' => 'account_in_use']), $location);
        $this->assertStringNotContainsString('owner', $location);
        $this->assertSame([['provider' => 'google', 'providerId' => 'g-owner', 'user' => 'owner@example.com']], $this->accounts());
    }

    public function testASecondAccountOfTheSameProviderIsRejected(): void
    {
        $user = $this->createUser('alice@example.com');
        $this->addAccount($user, 'google', 'g-1');
        $this->assertSame(self::profile(['link_error' => 'already_linked']), $this->link($user, 'google', ['sub' => 'g-2', 'email' => 'x@gmail.example']));
        $this->assertCount(1, $this->accounts());
    }

    public function testProviderErrorsInLinkModeGoBackToTheProfile(): void
    {
        $user = $this->createUser('alice@example.com');
        $location = $this->returnFrom('google', $this->startLink($user, 'google'), [], ['error' => 'access_denied']);
        $this->assertSame(self::profile(['link_error' => 'provider_denied']), $location);
        $this->assertSame(0, self::$providers['google']->fetchUserCalls);
        $this->assertSame([], $this->accounts());
    }

    // --- state separation ---

    public function testLinkStateIsNeverASignInStateAndViceVersa(): void
    {
        $user = $this->createUser('alice@example.com');
        $linkState = $this->startLink($user, 'google');

        self::$client->request('GET', self::API.'/api/auth/oauth/google?code_challenge='.\App\Security\OneTimeTokenService::challengeFor('x'));
        parse_str((string) parse_url((string) self::$client->getResponse()->headers->get('Location'), \PHP_URL_QUERY), $query);
        $loginState = (string) $query['state'];

        $signed = static::getContainer()->get(SignedTokenService::class);
        $this->assertNotNull($signed->verify('oauth.link_state', $linkState));
        $this->assertNull($signed->verify('oauth.state', $linkState));
        $this->assertNotNull($signed->verify('oauth.state', $loginState));
        $this->assertNull($signed->verify('oauth.link_state', $loginState));
    }

    public function testALinkFlowNeverSignsIn(): void
    {
        // Even a provider account that would sign in (known, verified) only goes to the profile.
        $user = $this->createUser('alice@example.com');
        $other = $this->createUser('bob@example.com');
        $this->addAccount($other, 'google', 'g-bob');
        $location = $this->link($user, 'google', ['sub' => 'g-bob', 'email' => 'bob@example.com', 'email_verified' => true]);
        $this->assertStringStartsWith(self::profile([]), $location);
        $this->assertStringNotContainsString('token', $location);
    }

    public function testASignInFlowNeverLinksToTheSignedInUser(): void
    {
        // The sign-in state carries no user: a signed-in browser that runs the sign-in flow gets the
        // sign-in policy (here: Microsoft never links an existing address), not a link.
        $user = $this->createUser('alice@example.com');
        self::$client->request('GET', self::API.'/api/auth/oauth/microsoft?code_challenge='.\App\Security\OneTimeTokenService::challengeFor('x'), [], [], ['HTTP_AUTHORIZATION' => $this->auth($user)]);
        parse_str((string) parse_url((string) self::$client->getResponse()->headers->get('Location'), \PHP_URL_QUERY), $query);
        $location = $this->returnFrom('microsoft', (string) $query['state'], ['sub' => 'ms-1', 'email' => 'alice@example.com']);
        $this->assertSame(self::$frontendUrl.'/auth/callback?error=account_exists', $location);
        $this->assertSame([], $this->accounts());
    }

    public function testLinkCallbackFromAnotherBrowserIsRejected(): void
    {
        $user = $this->createUser('alice@example.com');
        $state = $this->startLink($user, 'google');
        self::$client->getCookieJar()->clear();
        $location = $this->returnFrom('google', $state, ['sub' => 'g-attacker', 'email' => 'x@gmail.example']);
        $this->assertSame(self::$frontendUrl.'/auth/callback?error=invalid_state', $location);
        $this->assertSame([], $this->accounts());
    }

    public function testLinkStateIsSingleUse(): void
    {
        $user = $this->createUser('alice@example.com');
        $state = $this->startLink($user, 'google');
        $cookie = self::$client->getCookieJar()->get('oauth_state_nonce', '/api/auth/oauth', 'localhost');
        $this->complete($user, $this->returnFrom('google', $state, ['sub' => 'g-1']));
        self::$client->getCookieJar()->set($cookie);
        $this->assertSame(self::$frontendUrl.'/auth/callback?error=invalid_state', $this->returnFrom('google', $state, ['sub' => 'g-2']));
        $this->assertCount(1, $this->accounts());
    }

    public function testLinkStateOfAnotherProviderIsRejected(): void
    {
        $user = $this->createUser('alice@example.com');
        $state = $this->startLink($user, 'microsoft');
        $this->assertSame(self::$frontendUrl.'/auth/callback?error=invalid_state', $this->returnFrom('google', $state, ['sub' => 'g-1']));
        $this->assertSame([], $this->accounts());
    }

    public function testEndedSessionCannotFinishALink(): void
    {
        $user = $this->createUser('alice@example.com');
        $state = $this->startLink($user, 'google');
        // E.g. the password was reset meanwhile: all sessions ended.
        $fresh = $this->em->getRepository(User::class)->find($user->getId());
        $fresh->invalidateTokens();
        $this->em->flush();

        $this->assertSame(self::profile(['link_error' => 'invalid_state']), $this->returnFrom('google', $state, ['sub' => 'g-1']));
        $this->assertSame([], $this->accounts());
    }

    public function testATicketOpenedInAnotherBrowserNeverLinksThatBrowsersProviderAccount(): void
    {
        // Link CSRF: the attacker starts a link flow with HIS session and sends the ticket URL to the
        // victim. The victim's browser gets the state cookie and signs in at the provider with the
        // VICTIM's provider account. The callback must not attach that account to the attacker: it only
        // hands a proof to the victim's frontend, whose session (another user, or none) cannot complete it.
        $attacker = $this->createUser('mallory@example.com');
        $victim = $this->createUser('victim@example.com');
        $ticket = $this->ticket($attacker, 'google');

        self::$client->getCookieJar()->clear();
        $location = $this->openTicket('google', $ticket);
        parse_str((string) parse_url($location, \PHP_URL_QUERY), $query);
        $redirect = $this->returnFrom('google', (string) $query['state'], ['sub' => 'g-victim', 'email' => 'victim@gmail.example', 'email_verified' => true]);
        parse_str((string) parse_url($redirect, \PHP_URL_QUERY), $back);
        $this->assertSame([], $this->accounts());

        $this->assertSame(401, $this->completeRequest('google', (string) $back['link_proof'], null)['status']);
        $r = $this->completeRequest('google', (string) $back['link_proof'], $this->auth($victim));
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_state', $r['body']['code']);
        $this->assertSame([], $this->accounts());
    }

    public function testProofIsSingleUseShortLivedAndBoundToProviderAndSession(): void
    {
        $user = $this->createUser('alice@example.com');
        $proof = $this->proofFor($user, 'google', 'g-1');
        $this->assertSame(400, $this->completeRequest('microsoft', $proof, $this->auth($user))['status']);
        $this->assertSame(400, $this->completeRequest('google', 'forged.proof', $this->auth($user))['status']);
        $this->assertSame(204, $this->completeRequest('google', $proof, $this->auth($user))['status']);
        $this->assertSame(400, $this->completeRequest('google', $proof, $this->auth($user))['status']);

        self::mockTime();
        $late = $this->proofFor($user, 'microsoft', 'ms-1');
        self::mockTime('+301 seconds');
        $this->assertSame(400, $this->completeRequest('microsoft', $late, $this->auth($user))['status']);

        self::mockTime('+1 second');
        $ended = $this->proofFor($user, 'microsoft', 'ms-1');
        $fresh = $this->em->getRepository(User::class)->find($user->getId());
        $fresh->invalidateTokens();
        $this->em->flush();
        // A new session of the same user cannot complete a flow of the ended one.
        $this->assertSame(400, $this->completeRequest('microsoft', $ended, $this->auth($fresh))['status']);
        $this->assertSame([['provider' => 'google', 'providerId' => 'g-1', 'user' => 'alice@example.com']], $this->accounts());
    }

    // --- ticket ---

    public function testTicketIsSingleUseBoundToProviderAndShortLived(): void
    {
        $user = $this->createUser('alice@example.com');
        $ticket = $this->ticket($user, 'google');
        $this->assertStringStartsWith('https://provider.example/', $this->openTicket('google', $ticket));
        $this->assertSame(self::profile(['link_error' => 'invalid_state']), $this->openTicket('google', $ticket));

        $this->assertSame(self::profile(['link_error' => 'invalid_state']), $this->openTicket('microsoft', $this->ticket($user, 'google')));
        $this->assertSame(self::profile(['link_error' => 'invalid_state']), $this->openTicket('google', 'forged.ticket'));

        self::mockTime();
        $ticket = $this->ticket($user, 'google');
        self::mockTime('+61 seconds');
        $this->assertSame(self::profile(['link_error' => 'invalid_state']), $this->openTicket('google', $ticket));
    }

    public function testTicketOfAnEndedSessionIsRejected(): void
    {
        $user = $this->createUser('alice@example.com');
        $ticket = $this->ticket($user, 'google');
        $fresh = $this->em->getRepository(User::class)->find($user->getId());
        $fresh->invalidateTokens();
        $this->em->flush();
        $this->assertSame(self::profile(['link_error' => 'invalid_state']), $this->openTicket('google', $ticket));
    }

    // --- unlink ---

    public function testUnlinkRemovesTheLinkWhenAPasswordRemains(): void
    {
        $user = $this->createUser('alice@example.com');
        $this->addAccount($user, 'google', 'g-1');
        $r = TestHelper::jsonRequest(self::$client, 'DELETE', self::API.'/api/auth/oauth/google', [], $this->auth($user), $this->stepUpOf($this->auth($user)));
        $this->assertSame(204, $r['status'], $r['content']);
        $this->assertSame([], $this->accounts());
    }

    public function testUnlinkKeepsTheLastSignInMethod(): void
    {
        $user = $this->createUser('sso@example.com', false);
        $this->addAccount($user, 'google', 'g-1');
        $r = TestHelper::jsonRequest(self::$client, 'DELETE', self::API.'/api/auth/oauth/google', [], $this->auth($user), $this->stepUpOf($this->auth($user)));
        $this->assertSame(409, $r['status']);
        $this->assertSame('last_login_method', $r['body']['code']);
        $this->assertCount(1, $this->accounts());
    }

    public function testUnlinkIsAllowedWhenAPasskeyOrAnotherProviderRemains(): void
    {
        $user = $this->createUser('sso@example.com', false);
        $this->addAccount($user, 'google', 'g-1');
        $this->addAccount($user, 'microsoft', 'ms-1');
        $this->assertSame(204, TestHelper::jsonRequest(self::$client, 'DELETE', self::API.'/api/auth/oauth/google', [], $this->auth($user), $this->stepUpOf($this->auth($user)))['status']);
        $this->assertSame(409, TestHelper::jsonRequest(self::$client, 'DELETE', self::API.'/api/auth/oauth/microsoft', [], $this->auth($user), $this->stepUpOf($this->auth($user)))['status']);

        $user = $this->em->getRepository(User::class)->find($user->getId());
        $passkey = new Passkey();
        $passkey->setId('pk-1')->setUser($user)->setCredentialId('cred-1')->setPublicKey('key');
        $this->em->persist($passkey);
        $this->em->flush();
        $this->assertSame(204, TestHelper::jsonRequest(self::$client, 'DELETE', self::API.'/api/auth/oauth/microsoft', [], $this->auth($user), $this->stepUpOf($this->auth($user)))['status']);
        $this->assertSame([], $this->accounts());
    }

    public function testUnlinkOfAnUnknownLinkIs404AndOnlyAffectsTheOwnAccount(): void
    {
        $user = $this->createUser('alice@example.com');
        $other = $this->createUser('bob@example.com');
        $this->addAccount($other, 'google', 'g-bob');
        $r = TestHelper::jsonRequest(self::$client, 'DELETE', self::API.'/api/auth/oauth/google', [], $this->auth($user), $this->stepUpOf($this->auth($user)));
        $this->assertSame(404, $r['status']);
        $this->assertSame('oauth_account_not_found', $r['body']['code']);
        $this->assertCount(1, $this->accounts());

        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'DELETE', self::API.'/api/auth/oauth/google')['status']);
    }

    // --- Microsoft tid/oid ---

    private const string TID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const string OID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    public function testMicrosoftLinkStoresTenantAndObjectId(): void
    {
        $user = $this->createUser('alice@example.com');
        $this->assertSame(self::profile(['linked' => 'microsoft']), $this->link($user, 'microsoft', ['sub' => 'ms-1', 'email' => 'alice@example.com', 'tid' => self::TID, 'oid' => self::OID]));
        $this->em->clear();
        $account = $this->em->getRepository(OAuthAccount::class)->findOneBy(['provider' => 'microsoft']);
        $this->assertSame(self::TID, $account->getTenantId());
        $this->assertSame(self::OID, $account->getObjectId());
    }

    public function testMicrosoftAccountOfAnotherUserIsInUseEvenWithAChangedSub(): void
    {
        $owner = $this->createUser('owner@example.com');
        $this->assertSame(self::profile(['linked' => 'microsoft']), $this->link($owner, 'microsoft', ['sub' => 'ms-old', 'tid' => self::TID, 'oid' => self::OID]));
        $user = $this->createUser('alice@example.com');
        $this->assertSame(self::profile(['link_error' => 'account_in_use']), $this->link($user, 'microsoft', ['sub' => 'ms-new', 'tid' => self::TID, 'oid' => self::OID]));
        $this->assertCount(1, $this->accounts());
    }

    public function testRelinkWithChangedSubUpdatesTheSubAndBackfills(): void
    {
        $user = $this->createUser('alice@example.com');
        $this->addAccount($user, 'microsoft', 'ms-old');
        $this->assertSame(self::profile(['linked' => 'microsoft']), $this->link($user, 'microsoft', ['sub' => 'ms-old', 'tid' => self::TID, 'oid' => self::OID]));
        $this->assertSame(self::profile(['linked' => 'microsoft']), $this->link($user, 'microsoft', ['sub' => 'ms-new', 'tid' => self::TID, 'oid' => self::OID]));
        $this->assertSame('ms-new', $this->accounts()[0]['providerId']);
        $this->assertCount(1, $this->accounts());
    }

    public function testGoogleLinkIgnoresTenantAndObjectIdClaims(): void
    {
        $user = $this->createUser('alice@example.com');
        $this->link($user, 'google', ['sub' => 'g-1', 'email' => 'a@gmail.example', 'tid' => self::TID, 'oid' => self::OID]);
        $this->em->clear();
        $account = $this->em->getRepository(OAuthAccount::class)->findOneBy(['provider' => 'google']);
        $this->assertNull($account->getTenantId());
    }
}
