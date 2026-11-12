<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Passkey;
use App\Entity\User;
use App\Exception\OAuthAccountConflictException;
use App\OAuth\OAuthServerService;
use App\Security\Location;
use App\Security\LocationResolver;
use App\Security\OneTimeTokenService;
use App\Service\AuthService;
use App\Service\PasswordResetService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\SoftwareAuthenticator;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Security events of password change/reset: stored with client context, mail shows it in the account language. */
class SecurityEventTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;

    protected function setUp(): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $c->set(LocationResolver::class, new class implements LocationResolver {
            public function resolve(Request $request): Location
            {
                return 'none' === $request->headers->get('X-Test-Location') ? new Location() : new Location('Köln', 'DE');
            }
        });
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
    }

    private function user(string $language = 'en'): User
    {
        $user = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'alice@example.com');
        $user->setLanguage($language)->setName('Alice');
        $this->em->flush();

        return $user;
    }

    private function change(User $user, array $server = []): void
    {
        $auth = TestHelper::sessionHeader($user, static::getContainer()->get(TokenService::class));
        $this->client->request('POST', '/api/auth/change-password', [], [], array_merge([
            'CONTENT_TYPE' => 'application/json',
            'HTTP_AUTHORIZATION' => $auth,
            'HTTP_X_STEP_UP_TOKEN' => TestHelper::stepUp($this->client, $auth),
            'HTTP_USER_AGENT' => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'REMOTE_ADDR' => '203.0.113.7',
        ], $server), json_encode(['currentPassword' => 'password123', 'newPassword' => 'new-password-1']));
        $this->assertSame(200, $this->client->getResponse()->getStatusCode(), (string) $this->client->getResponse()->getContent());
    }

    /** @return list<array<string, mixed>> */
    private function events(): array
    {
        return static::getContainer()->get(Connection::class)->fetchAllAssociative("SELECT * FROM security_event WHERE type <> 'step_up' ORDER BY id");
    }

    private function mail(): Email
    {
        $mails = array_values(array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email));
        $this->assertCount(1, $mails);

        return $mails[0];
    }

    public function testPasswordChangeStoresEventAndMailShowsContext(): void
    {
        $this->change($this->user('en'));

        $events = $this->events();
        $this->assertCount(1, $events);
        $this->assertSame('password_changed', $events[0]['type']);
        $this->assertSame('203.0.113.7', $events[0]['ip']);
        $this->assertSame('Köln', $events[0]['city']);
        $this->assertSame('DE', $events[0]['country']);
        $this->assertSame('Chrome 126', $events[0]['browser']);
        $this->assertSame(1, (int) $events[0]['success']);

        $html = (string) $this->mail()->getHtmlBody();
        $this->assertStringContainsString('203.0.113.7', $html);
        $this->assertStringContainsString('Köln, Germany', $html);
        $this->assertStringContainsString('Chrome 126', $html);
    }

    public function testMailIsInTheAccountLanguage(): void
    {
        $this->change($this->user('de'));
        $this->assertStringContainsString('Köln, Deutschland', (string) $this->mail()->getHtmlBody());
    }

    public function testUnknownValuesAreShownAsUnknown(): void
    {
        $this->change($this->user('en'), ['HTTP_X_TEST_LOCATION' => 'none', 'HTTP_USER_AGENT' => '']);
        $html = (string) $this->mail()->getHtmlBody();
        $this->assertStringContainsString('Location:</strong> unknown', $html);
        $this->assertStringContainsString('Browser:</strong> unknown', $html);
        $this->assertNull($this->events()[0]['city']);
    }

    public function testPasswordResetStoresEvent(): void
    {
        $user = $this->user('en');
        $token = static::getContainer()->get(PasswordResetService::class)->createToken($user);
        $this->client->request('POST', '/api/auth/reset-password', [], [], [
            'CONTENT_TYPE' => 'application/json', 'REMOTE_ADDR' => '203.0.113.8',
        ], json_encode(['token' => $token, 'password' => 'new-password-1']));
        $this->assertSame(204, $this->client->getResponse()->getStatusCode());
        $events = $this->events();
        $this->assertCount(1, $events);
        $this->assertSame('password_changed', $events[0]['type']);
        $this->assertSame('reset', $events[0]['method']);
        $this->assertSame('203.0.113.8', $events[0]['ip']);
    }

    public function testDeletingTheUserRemovesItsEvents(): void
    {
        $user = $this->user();
        $this->change($user);
        $this->assertCount(1, $this->events());
        $this->em->clear();
        $this->em->remove($this->em->find(User::class, $user->getId()));
        $this->em->flush();
        $this->assertCount(0, $this->events());
    }

    /** @param array<string, mixed> $row */
    private function assertEvent(array $row, string $type, bool $success, ?string $method, ?string $provider): void
    {
        $this->assertSame($type, $row['type']);
        $this->assertSame($success, 1 === (int) $row['success']);
        $this->assertSame($method, $row['method']);
        $this->assertSame($provider, $row['provider']);
    }

    private function passwordLogin(string $email, string $password): int
    {
        $this->client->request('POST', '/api/auth/login', [], [], ['CONTENT_TYPE' => 'application/json', 'REMOTE_ADDR' => '203.0.113.9'], json_encode(['email' => $email, 'password' => $password]));

        return $this->client->getResponse()->getStatusCode();
    }

    public function testPasswordLoginSuccessAndFailureAreStored(): void
    {
        $this->client->disableReboot();
        $this->user();
        $this->assertSame(200, $this->passwordLogin('alice@example.com', 'password123'));
        $this->assertSame(401, $this->passwordLogin('alice@example.com', 'wrong-password'));

        $events = $this->events();
        $this->assertCount(2, $events);
        $this->assertEvent($events[0], 'login', true, 'password', null);
        $this->assertEvent($events[1], 'login', false, 'password', null);
        $this->assertSame('203.0.113.9', $events[1]['ip']);
    }

    public function testUnknownAddressIsNotLogged(): void
    {
        $this->user();
        $this->assertSame(401, $this->passwordLogin('nobody@example.com', 'password123'));
        $this->assertSame([], $this->events());
    }

    public function testRateLimitedLoginIsNotLogged(): void
    {
        $this->client->disableReboot();
        $this->user();
        $limited = false;
        for ($i = 0; $i < 8; ++$i) {
            if (429 === $this->passwordLogin('alice@example.com', 'wrong-password')) {
                $limited = true;
            }
        }
        $this->assertTrue($limited);
        $attempts = array_sum(array_column($this->events(), 'attempts'));
        $this->assertSame(5, $attempts);
    }

    public function testSsoCodeRedemptionStoresProviderAndCallbackConflictIsAFailure(): void
    {
        $user = $this->user();
        $auth = static::getContainer()->get(AuthService::class);
        $verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
        $code = $auth->issueOAuthLoginCode($user, OneTimeTokenService::challengeFor($verifier), 'microsoft');
        $auth->redeemOneTimeToken($code, $verifier);

        try {
            $auth->findOrCreateOAuthUser('microsoft', 'sub-1', 'alice@example.com', 'Alice', false);
            $this->fail('conflict expected');
        } catch (OAuthAccountConflictException) {
        }
        // a new, unknown address is not attributable and creates no failure row
        $auth->findOrCreateOAuthUser('google', 'sub-2', 'newbie@example.com', 'New', true);

        $events = $this->events();
        $this->assertCount(2, $events);
        $this->assertEvent($events[0], 'login', true, 'sso', 'microsoft');
        $this->assertEvent($events[1], 'login', false, 'sso', 'microsoft');
    }

    /** @return array{0: SoftwareAuthenticator, 1: string} */
    private function passkeyFor(User $user, string $name = 'Software'): array
    {
        $origin = rtrim((string) $_ENV['FRONTEND_URL'], '/');
        $auth = TestHelper::sessionHeader($user, static::getContainer()->get(TokenService::class));
        $stepUp = TestHelper::stepUp($this->client, $auth);
        $json = fn (string $m, string $u, array $d, string $a = '') => TestHelper::jsonRequest($this->client, $m, $u, $d, $a, $stepUp);
        $o = $json('POST', '/api/auth/webauthn/register/options', [], $auth);
        $authenticator = new SoftwareAuthenticator();
        $r = $json('POST', '/api/auth/webauthn/register/verify', [
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $authenticator->attestation($o['body']['options']['challenge'], $origin, 'localhost'),
            'deviceName' => $name,
        ], $auth);
        $this->assertSame(200, $r['status'], $r['content']);

        return [$authenticator, $auth];
    }

    private function passkeyLogin(SoftwareAuthenticator $authenticator, User $user, string $rpId): int
    {
        $origin = rtrim((string) $_ENV['FRONTEND_URL'], '/');
        $o = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/webauthn/authenticate/options');

        return TestHelper::jsonRequest($this->client, 'POST', '/api/auth/webauthn/authenticate/verify', [
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $authenticator->assertion($o['body']['options']['challenge'], $origin, $rpId, $user->getId()),
        ])['status'];
    }

    public function testPasskeyLoginFailureSuccessAndDeletion(): void
    {
        $this->client->disableReboot();
        $user = $this->user();
        [$authenticator, $auth] = $this->passkeyFor($user);

        $this->assertSame(401, $this->passkeyLogin($authenticator, $user, 'evil.example'));
        $this->assertSame(200, $this->passkeyLogin($authenticator, $user, 'localhost'));

        $id = $this->em->getRepository(Passkey::class)->findOneBy([])->getId();
        $r = TestHelper::jsonRequest($this->client, 'DELETE', '/api/auth/webauthn/'.$id, [], $auth, TestHelper::stepUp($this->client, $auth));
        $this->assertSame(200, $r['status'], $r['content']);

        $events = $this->events();
        $this->assertCount(4, $events);
        $types = array_column($events, 'type');
        sort($types);
        $this->assertSame(['login', 'login', 'passkey_added', 'passkey_deleted'], $types);
    }

    /** @return list<Email> */
    private function mails(): array
    {
        return array_values(array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email));
    }

    /** Registers a passkey and deletes it; returns the mails of the two requests (a request sees only its own). */
    private function addAndDeletePasskey(string $language): array
    {
        $this->client->disableReboot();
        $user = $this->user($language);
        [, $auth] = $this->passkeyFor($user);
        $added = $this->mails();
        $id = $this->em->getRepository(Passkey::class)->findOneBy([])->getId();
        $r = TestHelper::jsonRequest($this->client, 'DELETE', '/api/auth/webauthn/'.$id, [], $auth, TestHelper::stepUp($this->client, $auth));
        $this->assertSame(200, $r['status'], $r['content']);

        return [$added, $this->mails()];
    }

    public function testPasskeyAddedAndDeletedMailsAreQueuedOnceEachWithContext(): void
    {
        [$added, $deleted] = $this->addAndDeletePasskey('en');
        $this->assertCount(1, $added);
        $this->assertCount(1, $deleted);
        $html = (string) $added[0]->getHtmlBody();
        $this->assertSame('A passkey was added', $added[0]->getSubject());
        $this->assertStringNotContainsString('Software', $html);
        $this->assertStringContainsString('/forgot-password', $html);
        $this->assertSame('A passkey was deleted', $deleted[0]->getSubject());
        $this->assertStringContainsString('/forgot-password', (string) $deleted[0]->getHtmlBody());
    }

    public function testPasskeyNameNeverReachesTheMail(): void
    {
        $this->client->disableReboot();
        $this->passkeyFor($this->user('en'), 'Security update https://evil.example/r');
        $html = (string) $this->mails()[0]->getHtmlBody();
        $this->assertStringNotContainsString('evil.example', $html);
        $this->assertStringNotContainsString('Security update', $html);
    }

    public function testSsoAutoLinkIntoAnAccountWithoutMfaRecordsOneEventAndNoMail(): void
    {
        $user = $this->user();
        $auth = static::getContainer()->get(AuthService::class);
        $auth->findOrCreateOAuthUser('google', 'g-sub', 'alice@example.com', 'Alice', true);
        // signing in again with the linked provider is no new link
        $auth->findOrCreateOAuthUser('google', 'g-sub', 'alice@example.com', 'Alice', true);

        $events = $this->events();
        $this->assertCount(1, $events);
        $this->assertEvent($events[0], 'sso_linked', true, 'sso', 'google');
        $this->assertSame($user->getId(), $events[0]['user_id']);
        $this->assertSame([], $this->mails());
    }

    public function testNewSsoUserAndProfileLinkRecordOneEventEach(): void
    {
        $user = $this->user();
        $auth = static::getContainer()->get(AuthService::class);
        $auth->findOrCreateOAuthUser('google', 'g-new', 'newbie@example.com', 'New', true);
        $this->assertSame([], $this->events());
        $this->assertNull($auth->linkOAuthAccount($user, 'microsoft', 'm-sub', 'alice@example.com'));
        $events = $this->events();
        $this->assertCount(1, $events);
        $this->assertEvent($events[0], 'sso_linked', true, 'sso', 'microsoft');
    }

    public function testPasskeyMailsAreGermanForGermanAccounts(): void
    {
        [$added, $deleted] = $this->addAndDeletePasskey('de');
        $this->assertSame('Ein Passkey wurde hinzugefügt', $added[0]->getSubject());
        $this->assertSame('Ein Passkey wurde gelöscht', $deleted[0]->getSubject());
    }

    public function testUnknownPasskeyIsNotLogged(): void
    {
        $this->client->disableReboot();
        $user = $this->user();
        $this->assertSame(401, $this->passkeyLogin(new SoftwareAuthenticator(), $user, 'localhost'));
        $this->assertSame([], $this->events());
    }

    /** @return string id of an authorization request of a Claude client */
    private function authorizationRequest(): string
    {
        $redirect = 'https://claude.ai/api/mcp/auth_callback';
        $reg = TestHelper::jsonRequest($this->client, 'POST', '/api/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => [$redirect]]);
        $this->client->request('GET', '/api/oauth/authorize?'.http_build_query([
            'client_id' => $reg['body']['client_id'], 'redirect_uri' => $redirect, 'response_type' => 'code',
            'code_challenge' => 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'code_challenge_method' => 'S256',
            'scope' => 'mcp:read', 'state' => 'xyz', 'resource' => static::getContainer()->get(OAuthServerService::class)->canonicalResource(),
        ]));
        parse_str((string) parse_url((string) $this->client->getResponse()->headers->get('Location'), PHP_URL_QUERY), $q);

        return $q['request'];
    }

    public function testMcpAuthorizationApproveAndDenyAreStoredWithTheClientFamily(): void
    {
        $this->client->disableReboot();
        $user = $this->user();
        $auth = 'Bearer '.static::getContainer()->get(TokenService::class)->createAccessToken($user);
        foreach ([false, true] as $approve) {
            $r = TestHelper::jsonRequest($this->client, 'POST', '/api/oauth/authorize/decision', ['requestId' => $this->authorizationRequest(), 'approve' => $approve], $auth);
            $this->assertSame(200, $r['status'], $r['content']);
        }

        $events = $this->events();
        $this->assertCount(2, $events);
        $this->assertEvent($events[0], 'login', false, 'mcp', 'claude');
        $this->assertEvent($events[1], 'login', true, 'mcp', 'claude');
    }
}
