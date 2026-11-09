<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Opaque\Base64Url;
use App\Opaque\OpaqueKeys;
use App\Security\OneTimeTokenService;
use App\Security\SignedTokenService;
use App\Service\PasswordResetService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\FakeOAuth2Client;
use App\Tests\Helper\TestHelper;
use App\Tests\Opaque\OpaqueTestClient;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Final security review fixes: SSO takeover, key id binding, removed plaintext endpoints, upgrade offers. */
class OpaqueReviewFixesTest extends WebTestCase
{
    private const array VARS = ['OPAQUE_LEGACY_CUTOFF', 'OPAQUE_KEYS', 'OPAQUE_ACTIVE_KEY_ID'];
    private const string PASSWORD = 'correct horse battery';

    private KernelBrowser $client;
    private OpaqueTestClient $opaque;
    /** @var array<string, string|null> */
    private array $saved = [];

    protected function setUp(): void
    {
        foreach (self::VARS as $name) {
            $this->saved[$name] = $_SERVER[$name] ?? null;
        }
        $this->opaque = new OpaqueTestClient();
    }

    protected function tearDown(): void
    {
        $this->configure($this->saved);
    }

    /** @param array<string, string|null> $env */
    private function configure(array $env): void
    {
        foreach ($env as $name => $value) {
            if (null === $value) {
                unset($_SERVER[$name], $_ENV[$name]);
                putenv($name);
            } else {
                $_SERVER[$name] = $_ENV[$name] = $value;
                putenv("$name=$value");
            }
        }
    }

    /** @param array<string, string|null> $env */
    private function boot(array $env = []): void
    {
        $this->configure($env + ['OPAQUE_LEGACY_CUTOFF' => '', 'OPAQUE_KEYS' => '', 'OPAQUE_ACTIVE_KEY_ID' => '']);
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        DatabaseResetter::reset($this->em());
    }

    private function em(): EntityManagerInterface
    {
        return static::getContainer()->get(EntityManagerInterface::class);
    }

    private function legacyUser(string $email = 'ada@example.com', bool $verified = true): User
    {
        return TestHelper::createUser($this->em(), static::getContainer()->get(UserPasswordHasherInterface::class), $email, self::PASSWORD, $verified);
    }

    /** @return array{status: int, body: mixed, headers: array} */
    private function post(string $path, array $body, string $auth = ''): array
    {
        return TestHelper::jsonRequest($this->client, 'POST', $path, $body, $auth);
    }

    private function bearer(User $user): string
    {
        $this->em()->clear();

        return TestHelper::authHeader($this->em()->find(User::class, $user->getId()), static::getContainer()->get(TokenService::class));
    }

    /** @return array{start: array, record: string} */
    private function registration(array $credential, string $password = self::PASSWORD, string $auth = ''): array
    {
        $reg = $this->opaque->startRegistration($password);
        $start = $this->post('/api/auth/opaque/register/start', $credential + ['registrationRequest' => Base64Url::encode($reg['request'])], $auth);
        self::assertSame(200, $start['status'], json_encode($start['body']));
        $record = $this->opaque->finishRegistration($password, $reg['blind'], Base64Url::decode($start['body']['registrationResponse']))['record'];

        return ['start' => $start, 'record' => $record];
    }

    private function finish(array $flow, array $credential, ?string $state, array $extra = [], string $auth = ''): array
    {
        $body = $credential + ['registrationRecord' => Base64Url::encode($flow['record'])] + $extra;
        if (null !== $state) {
            $body['registrationState'] = $state;
        }

        return $this->post('/api/auth/opaque/register/finish', $body, $auth);
    }

    private function opaqueLoginStatus(string $email, string $password = self::PASSWORD): int
    {
        $ke1 = $this->opaque->startLogin($password);
        $start = $this->post('/api/auth/opaque/login/start', ['email' => $email, 'startLoginRequest' => Base64Url::encode($ke1['ke1'])]);
        $result = $this->opaque->finishLogin($password, $ke1, Base64Url::decode($start['body']['loginResponse']) ?? '');
        if (null === $result) {
            return 0;
        }

        return $this->post('/api/auth/opaque/login/finish', ['loginState' => $start['body']['loginState'], 'finishLoginRequest' => Base64Url::encode($result['ke3'])])['status'];
    }

    // --- C1: SSO takeover ---

    public function testTrustedSsoTakeoverRemovesAPreRegisteredOpaqueRecord(): void
    {
        $this->boot();
        $google = new FakeOAuth2Client();
        static::getContainer()->set('knpu.oauth2.client.google', $google);

        // The attacker signs up with the victim's address (unconfirmed) and an OPAQUE password.
        $flow = $this->registration(['email' => 'victim@example.com'], 'attacker-pass');
        $created = $this->finish($flow, [], $flow['start']['body']['registrationState'], ['name' => 'Mallory']);
        self::assertSame(201, $created['status'], json_encode($created['body']));
        self::assertSame(200, $this->post('/api/auth/opaque/login/start', ['email' => 'victim@example.com', 'startLoginRequest' => Base64Url::encode($this->opaque->startLogin('attacker-pass')['ke1'])])['status']);

        // The real owner signs in with Google (verified claim).
        $verifier = SignedTokenService::b64(random_bytes(32));
        $this->client->request('GET', 'https://localhost/api/auth/oauth/google?'.http_build_query(['code_challenge' => OneTimeTokenService::challengeFor($verifier)]));
        parse_str((string) parse_url((string) $this->client->getResponse()->headers->get('Location'), \PHP_URL_QUERY), $q);
        $google->claims = ['sub' => 'g-1', 'email' => 'victim@example.com', 'email_verified' => true, 'name' => 'Victim'];
        $this->client->request('GET', 'https://localhost/api/auth/oauth/google/callback?'.http_build_query(['code' => 'c', 'state' => $q['state']]));

        $this->em()->clear();
        $user = $this->em()->getRepository(User::class)->findOneBy(['email' => 'victim@example.com']);
        self::assertTrue($user->isEmailVerified());
        self::assertNull($user->getOpaqueRecord());
        self::assertNull($user->getOpaqueKeyId());
        self::assertNull($user->getOpaqueVersion());
        self::assertSame(0, $this->opaqueLoginStatus('victim@example.com', 'attacker-pass'));
    }

    // --- M1: key id binding ---

    private function twoKeys(string $active): array
    {
        static $ids = null;
        $ids ??= [
            '2:'.OpaqueKeys::encode(random_bytes(64)).':'.OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random()),
            '3:'.OpaqueKeys::encode(random_bytes(64)).':'.OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random()),
        ];

        return ['OPAQUE_KEYS' => implode(',', $ids), 'OPAQUE_ACTIVE_KEY_ID' => $active];
    }

    /** Same database, new kernel: simulates a key rotation between start and finish. */
    private function rebootWith(array $env): void
    {
        $this->configure($env);
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
    }

    public function testResetStoresTheKeyOfTheStartEvenAfterARotation(): void
    {
        $this->boot($this->twoKeys('2'));
        $user = $this->legacyUser();
        $token = static::getContainer()->get(PasswordResetService::class)->createToken($user);
        $flow = $this->registration(['resetToken' => $token]);
        $state = $flow['start']['body']['registrationState'];

        $this->rebootWith($this->twoKeys('3'));
        $r = $this->finish($flow, ['resetToken' => $token], $state);
        self::assertSame(204, $r['status'], json_encode($r['body']));

        $this->em()->clear();
        self::assertSame('2', $this->em()->find(User::class, $user->getId())->getOpaqueKeyId());
        self::assertSame(200, $this->opaqueLoginStatus('ada@example.com'));
    }

    public function testSignupStoresTheKeyOfTheStartEvenAfterARotation(): void
    {
        $this->boot($this->twoKeys('2'));
        $flow = $this->registration(['email' => 'new@example.com']);
        $state = $flow['start']['body']['registrationState'];

        $this->rebootWith($this->twoKeys('3'));
        $r = $this->finish($flow, [], $state, ['name' => 'New']);
        self::assertSame(201, $r['status'], json_encode($r['body']));

        $this->em()->clear();
        self::assertSame('2', $this->em()->getRepository(User::class)->findOneBy(['email' => 'new@example.com'])->getOpaqueKeyId());
    }

    public function testStateOfAKeyThatIsNoLongerConfiguredIsRefused(): void
    {
        $this->boot($this->twoKeys('2'));
        $user = $this->legacyUser();
        $token = static::getContainer()->get(PasswordResetService::class)->createToken($user);
        $flow = $this->registration(['resetToken' => $token]);

        $only3 = explode(',', $this->twoKeys('3')['OPAQUE_KEYS'])[1];
        $this->rebootWith(['OPAQUE_KEYS' => $only3, 'OPAQUE_ACTIVE_KEY_ID' => '3']);
        $r = $this->finish($flow, ['resetToken' => $token], $flow['start']['body']['registrationState']);
        self::assertSame(409, $r['status']);
        self::assertSame('opaque_state_invalid', $r['body']['code']);
    }

    public function testStateFromAnotherUserOrContextOrNoStateIsRefused(): void
    {
        $this->boot();
        $ada = $this->legacyUser('ada@example.com');
        $bob = $this->legacyUser('bob@example.com');
        $service = static::getContainer()->get(PasswordResetService::class);
        $adaToken = $service->createToken($ada);
        $bobToken = $service->createToken($bob);
        $adaFlow = $this->registration(['resetToken' => $adaToken]);
        $adaState = $adaFlow['start']['body']['registrationState'];

        foreach ([null, '', 'garbage'] as $missing) {
            $r = $this->finish($adaFlow, ['resetToken' => $adaToken], $missing);
            self::assertSame(409, $r['status']);
            self::assertSame('opaque_state_invalid', $r['body']['code']);
        }
        // Ada's state with Bob's link: other user.
        self::assertSame('opaque_state_invalid', $this->finish($adaFlow, ['resetToken' => $bobToken], $adaState)['body']['code']);
        // A signup state is no reset state (and the other way round).
        $signup = $this->registration(['email' => 'new@example.com']);
        self::assertSame('opaque_state_invalid', $this->finish($adaFlow, ['resetToken' => $adaToken], $signup['start']['body']['registrationState'])['body']['code']);
        self::assertSame('opaque_state_invalid', $this->finish($signup, [], $adaState, ['name' => 'N'])['body']['code']);
        // Ada's reset state against a change ticket of the same user: other context.
        $auth = $this->bearer($ada);
        $ticket = static::getContainer()->get(\App\Opaque\OpaqueReauthTickets::class)->issue($this->em()->find(User::class, $ada->getId()), 'change-password');
        self::assertSame('opaque_state_invalid', $this->finish($adaFlow, ['reauthTicket' => $ticket], $adaState, [], $auth)['body']['code']);

        // None of the refusals burned the link: the right state still works.
        self::assertSame(204, $this->finish($adaFlow, ['resetToken' => $adaToken], $adaState)['status']);
    }

    // --- M2: plaintext endpoints ---

    public function testPlaintextProofsAreRefusedForRecordAccounts(): void
    {
        $this->boot();
        $upgraded = $this->legacyUser('up@example.com');
        $flow = $this->registration(['email' => 'rec@example.com']);
        $this->finish($flow, [], $flow['start']['body']['registrationState'], ['name' => 'Rec']);
        $this->em()->clear();
        $upgradedUser = $this->em()->find(User::class, $upgraded->getId());
        $upgradedUser->setOpaque($flow['record'], 1, '1');
        $this->em()->flush();

        // Upgraded account (record + kept hash): plaintext proofs are refused, even the right password.
        $auth = $this->bearer($upgraded);
        foreach ([
            ['/api/auth/login', ['email' => 'up@example.com', 'password' => self::PASSWORD], ''],
            ['/api/auth/change-password', ['currentPassword' => self::PASSWORD, 'newPassword' => 'another staple horse'], $auth],
            ['/api/auth/change-email', ['email' => 'new@example.com', 'password' => self::PASSWORD], $auth],
            ['/api/auth/webauthn/register/options', ['password' => self::PASSWORD], $auth],
        ] as [$path, $body, $bearer]) {
            $r = $this->post($path, $body, $bearer);
            self::assertSame([409, 'opaque_required'], [$r['status'], $r['body']['code'] ?? null], $path);
        }
        $r = TestHelper::jsonRequest($this->client, 'DELETE', '/api/auth/me', ['password' => self::PASSWORD], $auth);
        self::assertSame([409, 'opaque_required'], [$r['status'], $r['body']['code']]);
        self::assertTrue($this->em()->find(User::class, $upgraded->getId())->hasPasswordCredential());

        // A bcrypt-only account keeps its legacy path (login, upgrade offer), as before.
        $legacy = $this->legacyUser('legacy@example.com');
        $login = $this->post('/api/auth/login', ['email' => 'legacy@example.com', 'password' => self::PASSWORD]);
        self::assertSame(200, $login['status']);
        self::assertArrayHasKey('opaqueUpgrade', $login['body']);
        self::assertSame(204, $this->post('/api/auth/change-email', ['email' => 'l2@example.com', 'password' => self::PASSWORD], $this->bearer($legacy))['status']);
    }

    public function testPlaintextRegisterAndResetRoutesAreGone(): void
    {
        $this->boot();
        $auth = $this->bearer($this->legacyUser());

        foreach ([
            ['/api/auth/register', ['name' => 'N', 'email' => 'x@example.com', 'password' => 'whatever12345', 'acceptedDocuments' => []]],
            ['/api/auth/reset-password', ['token' => 't', 'password' => 'whatever12345']],
        ] as [$path, $body]) {
            self::assertSame(404, $this->post($path, $body, $auth)['status'], $path);
            self::assertSame(404, $this->post($path, $body)['status'], $path);
        }
        self::assertNull($this->em()->getRepository(User::class)->findOneBy(['email' => 'x@example.com']));
    }

    // --- L2: unusable records get no upgrade ticket ---

    public function testNoUpgradeTicketForAnUnusableRecord(): void
    {
        $this->boot();
        $user = $this->legacyUser();
        $this->em()->clear();
        $this->em()->find(User::class, $user->getId())->setOpaque(sodium_crypto_scalarmult_ristretto255_base(sodium_crypto_core_ristretto255_scalar_random()).random_bytes(160), 1, 'unknown-key');
        $this->em()->flush();

        $login = $this->post('/api/auth/login', ['email' => 'ada@example.com', 'password' => self::PASSWORD]);
        self::assertSame(200, $login['status']);
        self::assertArrayNotHasKey('opaqueUpgrade', $login['body']);
        $me = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], 'Bearer '.$login['body']['access_token']);
        self::assertSame('legacy', $me['body']['passwordProtocol']);
    }
}
