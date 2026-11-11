<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Passkey;
use App\Entity\User;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\SoftwareAuthenticator;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Passkey registration and sign-in against a software authenticator (real ES256 signatures).
 */
class WebAuthnTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const string RP_ID = 'localhost';

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;
    private static string $origin;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
        self::$origin = rtrim((string) $_ENV['FRONTEND_URL'], '/');
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive across tests (see AuthTest).
    }

    // --- helpers ---

    private function auth(User $user): string
    {
        return 'Bearer '.self::$tokens->createAccessToken($user);
    }

    /** @return array{challenge: string, token: string} */
    private function options(string $kind, ?User $user = null): array
    {
        $register = 'register' === $kind;
        $r = TestHelper::jsonRequest(
            self::$client,
            $register ? 'POST' : 'GET',
            "/api/auth/webauthn/$kind/options",
            $register ? ['password' => 'password123'] : [],
            $user ? $this->auth($user) : '',
        );
        $this->assertSame(200, $r['status'], $r['content']);

        return ['challenge' => $r['body']['options']['challenge'], 'token' => $r['body']['challengeToken']];
    }

    private function register(User $user, SoftwareAuthenticator $authenticator, array $override = [], ?array $opts = null): array
    {
        $opts ??= $this->options('register', $user);

        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/verify', [
            'challengeToken' => $opts['token'],
            'response' => $authenticator->attestation($opts['challenge'], self::$origin, self::RP_ID, $override),
            'deviceName' => 'Software',
        ], $this->auth($user));
    }

    /** @return array{0: User, 1: SoftwareAuthenticator} */
    private function userWithPasskey(string $email = 'alice@example.com'): array
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, $email);
        $authenticator = new SoftwareAuthenticator();
        $r = $this->register($user, $authenticator);
        $this->assertSame(200, $r['status'], $r['content']);

        return [$user, $authenticator];
    }

    private function login(array $opts, array $response): array
    {
        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/authenticate/verify', [
            'challengeToken' => $opts['token'],
            'response' => $response,
        ]);
    }

    private function assertRejected(array $r): void
    {
        $this->assertSame(401, $r['status'], $r['content']);
        $this->assertArrayNotHasKey('access_token', $r['body'] ?? []);
    }

    // --- sign-in ---

    public function testValidPasskeySignInReturnsTokensForTheOwner(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $r = $this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId()));

        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame('alice@example.com', $r['body']['user']['email']);
        $this->assertNotEmpty($r['body']['access_token']);
        $this->assertNotEmpty($r['body']['refresh_token']);

        // The issued session works (access token and refresh).
        $me = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], 'Bearer '.$r['body']['access_token']);
        $this->assertSame(200, $me['status'], $me['content']);
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $r['body']['refresh_token']]);
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
    }

    public function testCounterIsStoredAndMustIncrease(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $authenticator->signCount = 41;
        $opts = $this->options('authenticate');
        $this->assertSame(200, $this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId()))['status']);
        self::$em->clear();
        $this->assertSame(42, self::$em->getRepository(Passkey::class)->findOneBy([])->getCounter());
    }

    public function testSignInRecordsLastUsedAtInUtcAndTheListShowsIt(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $me = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $this->auth($user));
        $this->assertNull($me['body']['passkeys'][0]['lastUsedAt']);

        // A failed attempt is no use.
        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, 'evil.example', $user->getId())));
        self::$em->clear();
        $this->assertNull(self::$em->getRepository(Passkey::class)->findOneBy([])->getLastUsedAt());

        self::mockTime('2026-10-13 12:00:00 Europe/Berlin');
        $opts = $this->options('authenticate');
        $this->assertSame(200, $this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId()))['status']);

        $me = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $this->auth($user));
        $this->assertSame('2026-10-13T10:00:00+00:00', $me['body']['passkeys'][0]['lastUsedAt']);
        $this->assertSame('Software', $me['body']['passkeys'][0]['deviceName']);
    }

    public function testWrongSignatureIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $response = $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId());
        $sig = base64_decode(strtr($response['response']['signature'], '-_', '+/'));
        $sig[10] = chr(ord($sig[10]) ^ 0x01);
        $response['response']['signature'] = SoftwareAuthenticator::b64($sig);

        $this->assertRejected($this->login($opts, $response));
    }

    public function testWrongChallengeIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $other = $this->options('authenticate');
        // Signed over a different (also server-issued) challenge than the one in the token.
        $this->assertRejected($this->login($opts, $authenticator->assertion($other['challenge'], self::$origin, self::RP_ID, $user->getId())));
    }

    public function testExpiredChallengeIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        self::mockTime();
        $opts = $this->options('authenticate');
        self::mockTime('+10 minutes');

        $this->assertRejected($this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId())));
    }

    public function testReplayedResponseIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $response = $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId());

        $this->assertSame(200, $this->login($opts, $response)['status']);
        $this->assertRejected($this->login($opts, $response));
    }

    public function testReusedChallengeTokenWithFreshSignatureIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $this->assertSame(200, $this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId()))['status']);
        // Higher counter, valid signature, but the challenge was already used.
        $this->assertRejected($this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId())));
    }

    public function testWrongOriginIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $authenticator->assertion(
            $opts['challenge'], self::$origin, self::RP_ID, $user->getId(), ['origin' => 'https://evil.example'],
        )));
    }

    public function testWrongRpIdIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $authenticator->assertion(
            $opts['challenge'], self::$origin, self::RP_ID, $user->getId(), ['rpId' => 'evil.example'],
        )));
    }

    public function testWrongClientDataTypeIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $authenticator->assertion(
            $opts['challenge'], self::$origin, self::RP_ID, $user->getId(), ['type' => 'webauthn.create'],
        )));
    }

    public function testMissingUserPresenceIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $authenticator->assertion(
            $opts['challenge'], self::$origin, self::RP_ID, $user->getId(), ['flags' => SoftwareAuthenticator::FLAG_UV],
        )));
    }

    public function testForeignCredentialIdSignedWithOwnKeyIsRejected(): void
    {
        [$victim] = $this->userWithPasskey('victim@example.com');
        $victimCredentialId = self::$em->getRepository(Passkey::class)->findOneBy([])->getCredentialId();

        // The attacker knows the victim's credential ID and user handle, but not the private key.
        $forged = new SoftwareAuthenticator(base64_decode($victimCredentialId));
        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $forged->assertion($opts['challenge'], self::$origin, self::RP_ID, $victim->getId())));
    }

    public function testUserHandleOfAnotherUserIsRejected(): void
    {
        [, $authenticator] = $this->userWithPasskey('alice@example.com');
        $bob = TestHelper::createUser(self::$em, self::$hasher, 'bob@example.com');
        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $authenticator->assertion(
            $opts['challenge'], self::$origin, self::RP_ID, $bob->getId(),
        )));
    }

    public function testUnknownCredentialIdAndWrongSignatureLookTheSame(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();

        $opts = $this->options('authenticate');
        $unknown = new SoftwareAuthenticator();
        $a = $this->login($opts, $unknown->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId()));

        $opts = $this->options('authenticate');
        $response = $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId(), [
            'signWith' => new SoftwareAuthenticator(),
        ]);
        $b = $this->login($opts, $response);

        $this->assertRejected($a);
        $this->assertRejected($b);
        $this->assertSame($a['content'], $b['content']);
    }

    public function testCounterGoingBackwardsIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $authenticator->signCount = 10;
        $opts = $this->options('authenticate');
        $this->assertSame(200, $this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId()))['status']);

        // A cloned authenticator still at an older counter value.
        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $authenticator->assertion(
            $opts['challenge'], self::$origin, self::RP_ID, $user->getId(), ['signCount' => 5],
        )));
    }

    public function testZeroCounterIsToleratedWhenTheAuthenticatorHasNone(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        for ($i = 0; $i < 2; ++$i) {
            $opts = $this->options('authenticate');
            $r = $this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId(), ['signCount' => 0]));
            $this->assertSame(200, $r['status'], $r['content']);
        }
    }

    public function testTamperedAuthenticatorDataIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        // Signed with UP only, then the UV flag is added afterwards.
        $this->assertRejected($this->login($opts, $authenticator->assertion(
            $opts['challenge'], self::$origin, self::RP_ID, $user->getId(), [
                'flags' => SoftwareAuthenticator::FLAG_UP,
                'tamper' => static function (string $authData): string {
                    $authData[32] = chr(ord($authData[32]) | SoftwareAuthenticator::FLAG_UV);

                    return $authData;
                },
            ],
        )));
    }

    public function testRegistrationChallengeTokenCannotBeUsedForSignIn(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('register', $user);
        $this->assertRejected($this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId())));
    }

    public function testPasskeyStoredInTheOldFormatStillSignsInAndIsConverted(): void
    {
        // Before the fix the raw attestation object was stored instead of the public key.
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $authenticator = new SoftwareAuthenticator();
        $attestation = $authenticator->attestation(str_repeat('A', 43), self::$origin, self::RP_ID);
        $passkey = (new Passkey())
            ->setId('legacy-1')
            ->setUser($user)
            ->setCredentialId(base64_encode($authenticator->credentialId))
            ->setPublicKey(base64_decode(strtr($attestation['response']['attestationObject'], '-_', '+/')))
            ->setCounter(0);
        self::$em->persist($passkey);
        self::$em->flush();

        $opts = $this->options('authenticate');
        $r = $this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId()));
        $this->assertSame(200, $r['status'], $r['content']);
        self::$em->clear();
        $this->assertSame($authenticator->cosePublicKey(), self::$em->getRepository(Passkey::class)->find('legacy-1')->getPublicKey());

        $opts = $this->options('authenticate');
        $forged = new SoftwareAuthenticator($authenticator->credentialId);
        $this->assertRejected($this->login($opts, $forged->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId())));
    }

    // --- registration ---

    public function testRegistrationStoresTheCosePublicKey(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $authenticator = new SoftwareAuthenticator();
        $r = $this->register($user, $authenticator);
        $this->assertSame(200, $r['status']);

        self::$em->clear();
        $passkey = self::$em->getRepository(Passkey::class)->findOneBy([]);
        $this->assertTrue($r['body']['ok'] ?? false);
        $this->assertSame($passkey->getId(), $r['body']['id'] ?? null);
        $this->assertSame(base64_encode($authenticator->credentialId), $passkey->getCredentialId());
        $this->assertSame($authenticator->cosePublicKey(), $passkey->getPublicKey());
    }

    public function testRegistrationWithWrongOriginIsRejected(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $this->assertSame(400, $this->register($user, new SoftwareAuthenticator(), ['origin' => 'https://evil.example'])['status']);
        $this->assertSame(0, self::$em->getRepository(Passkey::class)->count([]));
    }

    public function testRegistrationWithWrongChallengeIsRejected(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $other = $this->options('register', $user);
        $this->assertSame(400, $this->register($user, new SoftwareAuthenticator(), ['challenge' => $other['challenge']])['status']);
        $this->assertSame(0, self::$em->getRepository(Passkey::class)->count([]));
    }

    public function testRegistrationWithWrongClientDataTypeIsRejected(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $this->assertSame(400, $this->register($user, new SoftwareAuthenticator(), ['type' => 'webauthn.get'])['status']);
        $this->assertSame(0, self::$em->getRepository(Passkey::class)->count([]));
    }

    public function testRegistrationWithWrongRpIdIsRejected(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $this->assertSame(400, $this->register($user, new SoftwareAuthenticator(), ['rpId' => 'evil.example'])['status']);
        $this->assertSame(0, self::$em->getRepository(Passkey::class)->count([]));
    }

    public function testRegistrationChallengeOfAnotherUserIsRejected(): void
    {
        $alice = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $mallory = TestHelper::createUser(self::$em, self::$hasher, 'mallory@example.com');
        $aliceOpts = $this->options('register', $alice);

        // Mallory submits a challenge token issued to Alice.
        $this->assertSame(400, $this->register($mallory, new SoftwareAuthenticator(), [], $aliceOpts)['status']);
        $this->assertSame(0, self::$em->getRepository(Passkey::class)->count([]));
    }

    public function testRegistrationChallengeCanBeUsedOnlyOnce(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $opts = $this->options('register', $user);
        $this->assertSame(200, $this->register($user, new SoftwareAuthenticator(), [], $opts)['status']);
        $this->assertSame(400, $this->register($user, new SoftwareAuthenticator(), [], $opts)['status']);
        $this->assertSame(1, self::$em->getRepository(Passkey::class)->count([]));
    }

    public function testRegistrationCannotTakeOverAnotherUsersCredentialId(): void
    {
        [$alice] = $this->userWithPasskey('alice@example.com');
        $stored = self::$em->getRepository(Passkey::class)->findOneBy([]);
        $mallory = TestHelper::createUser(self::$em, self::$hasher, 'mallory@example.com');

        $r = $this->register($mallory, new SoftwareAuthenticator(base64_decode($stored->getCredentialId())));
        $this->assertSame(400, $r['status']);
        $this->assertSame('passkey_already_registered', $r['body']['code'] ?? null);
        self::$em->clear();
        $passkeys = self::$em->getRepository(Passkey::class)->findAll();
        $this->assertCount(1, $passkeys);
        $this->assertSame($alice->getId(), $passkeys[0]->getUser()->getId());
    }

    public function testRegistrationRequiresSignIn(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/options', ['password' => 'password123']);
        $this->assertSame(401, $r['status']);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/code');
        $this->assertSame(401, $r['status']);
    }

    // --- deletion ---

    public function testPasskeyOfAnotherUserCannotBeDeleted(): void
    {
        $this->userWithPasskey('alice@example.com');
        $passkeyId = self::$em->getRepository(Passkey::class)->findOneBy([])->getId();
        $mallory = TestHelper::createUser(self::$em, self::$hasher, 'mallory@example.com');

        $r = TestHelper::jsonRequest(self::$client, 'DELETE', "/api/auth/webauthn/$passkeyId", ['password' => 'password123'], $this->auth($mallory));
        $this->assertSame(404, $r['status']);
        $this->assertSame(1, self::$em->getRepository(Passkey::class)->count([]));
    }

    // --- adversarial ---

    /** Builds a correctly signed assertion from arbitrary authenticatorData / clientDataJSON. */
    private static function signedAssertion(SoftwareAuthenticator $a, string $authData, string $clientData, string $userHandle): array
    {
        return [
            'id' => SoftwareAuthenticator::b64($a->credentialId),
            'rawId' => SoftwareAuthenticator::b64($a->credentialId),
            'type' => 'public-key',
            'response' => [
                'clientDataJSON' => SoftwareAuthenticator::b64($clientData),
                'authenticatorData' => SoftwareAuthenticator::b64($authData),
                'signature' => SoftwareAuthenticator::b64($a->sign($authData.hash('sha256', $clientData, true))),
                'userHandle' => SoftwareAuthenticator::b64($userHandle),
            ],
            'clientExtensionResults' => new \stdClass(),
        ];
    }

    private static function authData(int $flags, int $count, string $suffix = ''): string
    {
        return hash('sha256', self::RP_ID, true).chr($flags).pack('N', $count).$suffix;
    }

    private static function clientData(string $challenge, array $extra = [], ?string $origin = null): string
    {
        return json_encode($extra + ['type' => 'webauthn.get', 'challenge' => $challenge, 'origin' => $origin ?? self::$origin, 'crossOrigin' => false], \JSON_UNESCAPED_SLASHES);
    }

    private static function b64decode(string $s): string
    {
        return (string) base64_decode(strtr($s, '-_', '+/'));
    }

    /** @return array{0: string, 1: string} r and s of a DER ECDSA signature */
    private static function derParse(string $der): array
    {
        $rLen = ord($der[3]);
        $r = substr($der, 4, $rLen);
        $s = substr($der, 6 + $rLen, ord($der[5 + $rLen]));

        return [$r, $s];
    }

    private static function derInt(string $bytes): string
    {
        $bytes = ltrim($bytes, "\0");
        if ('' === $bytes || ord($bytes[0]) & 0x80) {
            $bytes = "\0".$bytes;
        }

        return "\x02".chr(strlen($bytes)).$bytes;
    }

    public function testSignatureByAnotherKeyIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId(), [
            'signWith' => new SoftwareAuthenticator(),
        ])));
    }

    public function testTruncatedOrEmptySignatureIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        foreach ([static fn (string $sig) => substr($sig, 0, -4), static fn () => '', static fn () => "\x30\x00"] as $mutate) {
            $opts = $this->options('authenticate');
            $response = $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId());
            $response['response']['signature'] = SoftwareAuthenticator::b64($mutate(self::b64decode($response['response']['signature'])));
            $this->assertRejected($this->login($opts, $response));
        }
    }

    public function testHighSSignatureVariantCannotReplayAUsedResponse(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $response = $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId());
        $this->assertSame(200, $this->login($opts, $response)['status']);

        // (r, n - s) is an equally valid ECDSA signature over the same data (malleability).
        [$r, $sv] = self::derParse(self::b64decode($response['response']['signature']));
        $n = gmp_init('FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551', 16);
        $s2 = gmp_export(gmp_sub($n, gmp_import($sv)));
        $body = self::derInt($r).self::derInt($s2);
        $response['response']['signature'] = SoftwareAuthenticator::b64("\x30".chr(strlen($body)).$body);

        $this->assertRejected($this->login($opts, $response));
    }

    public function testAuthenticatorDataFlagAndExtensionManipulation(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $up = SoftwareAuthenticator::FLAG_UP;
        $cases = [
            // AT set in an assertion without attested credential data
            'AT without data' => self::authData($up | SoftwareAuthenticator::FLAG_AT, 5),
            // ED set but no extension data follows
            'ED without data' => self::authData($up | 0x80, 6),
            // extension data appended without the ED flag
            'data without ED' => self::authData($up, 7, "\xA1\x63foo\xF5"),
            // backup state without backup eligibility
            'BS without BE' => self::authData($up | 0x10, 8),
            // trailing garbage
            'trailing bytes' => self::authData($up, 9, "\x00"),
        ];
        foreach ($cases as $label => $authData) {
            $opts = $this->options('authenticate');
            $r = $this->login($opts, self::signedAssertion($authenticator, $authData, self::clientData($opts['challenge']), $user->getId()));
            $this->assertSame(401, $r['status'], $label.': '.$r['content']);
        }

        // Extension data appended after signing (flag and data both unsigned).
        $opts = $this->options('authenticate');
        $response = self::signedAssertion($authenticator, self::authData($up, 10), self::clientData($opts['challenge']), $user->getId());
        $response['response']['authenticatorData'] = SoftwareAuthenticator::b64(self::authData($up | 0x80, 10, "\xA1\x63foo\xF5"));
        $this->assertRejected($this->login($opts, $response));
    }

    public function testExtraClientDataFieldsAreIgnoredButCrossOriginIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $ok = $this->login($opts, self::signedAssertion($authenticator, self::authData(SoftwareAuthenticator::FLAG_UP, 3), self::clientData($opts['challenge'], [
            'other_keys_can_be_added_here' => 'do not compare clientDataJSON against a template',
        ]), $user->getId()));
        $this->assertSame(200, $ok['status'], $ok['content']);

        foreach ([['crossOrigin' => true], ['crossOrigin' => true, 'topOrigin' => 'https://evil.example']] as $i => $extra) {
            $opts = $this->options('authenticate');
            $this->assertRejected($this->login($opts, self::signedAssertion(
                $authenticator, self::authData(SoftwareAuthenticator::FLAG_UP, 10 + $i), self::clientData($opts['challenge'], $extra), $user->getId(),
            )));
        }
    }

    public function testLookalikeOriginsAreRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $p = parse_url(self::$origin);
        $host = $p['host'];
        $port = isset($p['port']) ? ':'.$p['port'] : '';
        $scheme = $p['scheme'];
        $otherScheme = 'https' === $scheme ? 'http' : 'https';
        $origins = [
            "$scheme://$host$port.evil.example",
            "$scheme://$host.evil.example$port",
            "$scheme://evil.example$port",
            "$scheme://sub.$host$port",
            "$otherScheme://$host$port",
            "$scheme://$host:1".($port ? substr($port, 1) : '443'),
            "$scheme://$host$port@evil.example",
            "$scheme://evil.example/$scheme://$host$port",
            self::$origin."\u{0000}",
            strtoupper(self::$origin).'x',
            '',
            'null',
        ];
        $count = 20;
        foreach ($origins as $origin) {
            $opts = $this->options('authenticate');
            $r = $this->login($opts, self::signedAssertion(
                $authenticator, self::authData(SoftwareAuthenticator::FLAG_UP, ++$count), self::clientData($opts['challenge'], [], $origin), $user->getId(),
            ));
            $this->assertSame(401, $r['status'], "origin '$origin' was accepted");
        }
    }

    public function testChallengeMustBeTheIssuedOne(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $variants = [
            // standard base64 with padding instead of base64url
            static fn (string $c) => base64_encode(self::b64decode($c)),
            // challenge with one bit flipped
            static function (string $c) {
                $b = self::b64decode($c);
                $b[0] = chr(ord($b[0]) ^ 1);

                return SoftwareAuthenticator::b64($b);
            },
            // truncated challenge
            static fn (string $c) => substr($c, 0, 22),
            static fn () => '',
        ];
        $count = 50;
        foreach ($variants as $i => $variant) {
            $opts = $this->options('authenticate');
            $challenge = $variant($opts['challenge']);
            if ($challenge === $opts['challenge']) {
                continue; // base64 of these bytes may coincide with base64url
            }
            $r = $this->login($opts, self::signedAssertion($authenticator, self::authData(SoftwareAuthenticator::FLAG_UP, ++$count), self::clientData($challenge), $user->getId()));
            $this->assertSame(401, $r['status'], "variant $i: ".$r['content']);
        }
    }

    public function testSignInChallengeTokenCannotBeUsedForRegistration(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $opts = $this->options('authenticate');
        $this->assertSame(400, $this->register($user, new SoftwareAuthenticator(), [], $opts)['status']);
        $this->assertSame(0, self::$em->getRepository(Passkey::class)->count([]));
    }

    public function testChallengeTokenWithManipulatedClaimsIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        [$body, $sig] = explode('.', $opts['token']);
        $claims = json_decode(self::b64decode($body), true);

        foreach ([['exp' => $claims['exp'] + 86400], ['p' => 'webauthn.create'], ['exp' => (string) $claims['exp']]] as $change) {
            $forged = SoftwareAuthenticator::b64(json_encode($change + $claims)).'.'.$sig;
            $this->assertRejected($this->login(['token' => $forged], $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId())));
        }
        foreach (['', '.', $body, $body.'.'.$sig.'.x', $body.'.', '.'.$sig] as $forged) {
            $this->assertRejected($this->login(['token' => $forged], $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId())));
        }
        // The untouched token still works (the forgeries did not consume it).
        $this->assertSame(200, $this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId()))['status']);
    }

    public function testMissingUserHandleIsRejected(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $opts = $this->options('authenticate');
        $response = $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId());
        unset($response['response']['userHandle']);
        $this->assertRejected($this->login($opts, $response));

        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId(), ['userHandle' => ''])));
    }

    public function testFailedAttemptsDoNotChangeTheCounterOrLockOutTheOwner(): void
    {
        [$user, $authenticator] = $this->userWithPasskey();
        $authenticator->signCount = 7;
        $opts = $this->options('authenticate');
        $this->assertRejected($this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId(), [
            'signWith' => new SoftwareAuthenticator(), 'signCount' => 1000,
        ])));
        self::$em->clear();
        $this->assertSame(0, self::$em->getRepository(Passkey::class)->findOneBy([])->getCounter());

        $opts = $this->options('authenticate');
        $this->assertSame(200, $this->login($opts, $authenticator->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId()))['status']);
    }

    public function testConsumingTheSameChallengeFromTwoConnectionsSucceedsOnlyOnce(): void
    {
        // Two PHP processes verifying the same response in parallel: the unique index decides.
        $store = static::getContainer()->get(\App\Security\NonceStore::class);
        $params = self::$em->getConnection()->getParams();
        $second = \Doctrine\DBAL\DriverManager::getConnection($params);
        $other = new \App\Security\NonceStore($second, new \Symfony\Component\Clock\NativeClock());
        $exp = time() + 300;

        $this->assertTrue($store->consume('webauthn.get', 'race', $exp));
        $this->assertFalse($other->consume('webauthn.get', 'race', $exp));
        $this->assertFalse($store->consume('webauthn.get', 'race', $exp));
        // Same value for another purpose is independent.
        $this->assertTrue($other->consume('webauthn.create', 'race', $exp));
        $second->close();
    }

    public function testConsumedNonceSurvivesCleanupOnANonUtcServer(): void
    {
        $previous = date_default_timezone_get();
        date_default_timezone_set('Pacific/Kiritimati'); // UTC+14
        try {
            $store = new \App\Security\NonceStore(self::$em->getConnection(), new \Symfony\Component\Clock\NativeClock());
            $exp = time() + 300;
            $this->assertTrue($store->consume('webauthn.get', 'tz-1', $exp));
            // Any later consume purges expired entries; the first one must not be among them.
            $this->assertTrue($store->consume('webauthn.get', 'tz-2', $exp));
            $this->assertFalse($store->consume('webauthn.get', 'tz-1', $exp));
        } finally {
            date_default_timezone_set($previous);
        }
    }

    public function testExpiredNoncesAreCleanedUp(): void
    {
        $conn = self::$em->getConnection();
        $store = new \App\Security\NonceStore($conn, new \Symfony\Component\Clock\NativeClock());
        $this->assertTrue($store->consume('webauthn.get', 'old', time() - 3600));
        $this->assertTrue($store->consume('webauthn.get', 'new', time() + 300));
        $this->assertSame(1, (int) $conn->fetchOne('SELECT COUNT(*) FROM auth_nonce'));
    }

    public function testMalformedRequestBodiesEndInClientErrors(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $opts = $this->options('authenticate');
        $valid = (new SoftwareAuthenticator())->assertion($opts['challenge'], self::$origin, self::RP_ID, $user->getId());
        $bodies = [
            '', 'null', '1', '"x"', '[]', '{', '{"challengeToken": []}',
            json_encode(['challengeToken' => 1, 'response' => $valid]),
            json_encode(['challengeToken' => $opts['token'], 'response' => 'x']),
            json_encode(['challengeToken' => $opts['token'], 'response' => []]),
            json_encode(['challengeToken' => $opts['token'], 'response' => ['id' => 1, 'rawId' => [], 'type' => 'public-key', 'response' => 'x']]),
            json_encode(['challengeToken' => $opts['token'], 'response' => ['rawId' => '!!!', 'id' => '!!!', 'type' => 'public-key', 'response' => ['clientDataJSON' => 5, 'authenticatorData' => [], 'signature' => null]]]),
            json_encode(['challengeToken' => $opts['token'], 'response' => array_replace_recursive($valid, ['response' => ['clientDataJSON' => SoftwareAuthenticator::b64(str_repeat('{', 200000))]])]),
            json_encode(['challengeToken' => str_repeat('a.', 100000), 'response' => $valid]),
        ];
        foreach ($bodies as $i => $body) {
            $opts = $this->options('authenticate');
            self::$client->request('POST', '/api/auth/webauthn/authenticate/verify', [], [], ['CONTENT_TYPE' => 'application/json'], $body);
            $status = self::$client->getResponse()->getStatusCode();
            $this->assertContains($status, [400, 401], "sign-in body $i -> $status");
        }

        $auth = $this->auth($user);
        $reg = $this->options('register', $user);
        $attestation = (new SoftwareAuthenticator())->attestation($reg['challenge'], self::$origin, self::RP_ID);
        $bodies = [
            '', 'null', '[]', '{"challengeToken": "x", "response": "y"}',
            json_encode(['challengeToken' => $reg['token'], 'response' => $attestation, 'deviceName' => ['x']]),
            json_encode(['challengeToken' => $reg['token'], 'response' => $attestation, 'deviceName' => str_repeat('ü', 256)]),
            json_encode(['challengeToken' => $reg['token'], 'response' => array_replace_recursive($attestation, ['response' => ['attestationObject' => 'AAAA']])]),
        ];
        foreach ($bodies as $i => $body) {
            self::$client->request('POST', '/api/auth/webauthn/register/verify', [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => $auth], $body);
            $status = self::$client->getResponse()->getStatusCode();
            $this->assertSame(400, $status, "registration body $i -> $status");
        }
        $this->assertSame(0, self::$em->getRepository(Passkey::class)->count([]));
    }

    public function testOverlongCredentialIdIsRejectedWithoutServerError(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $r = $this->register($user, new SoftwareAuthenticator(random_bytes(1000)));
        $this->assertSame(400, $r['status'], $r['content']);
    }

    public function testRegistrationAttestationFormats(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $text = SoftwareAuthenticator::cborText(...);
        $bytes = SoftwareAuthenticator::cborBytes(...);

        // packed self-attestation, correctly signed by the credential key
        $a = new SoftwareAuthenticator();
        $selfAttested = $this->register($user, $a, ['attStmt' => static fn (string $authData, string $cdh) => [
            'packed', "\xA2".$text('alg')."\x26".$text('sig').$bytes($a->sign($authData.$cdh)),
        ]]);
        $this->assertSame(200, $selfAttested['status'], $selfAttested['content']);

        $rejected = [
            // packed self-attestation signed by another key
            'packed, foreign signature' => static fn (string $authData, string $cdh) => [
                'packed', "\xA2".$text('alg')."\x26".$text('sig').$bytes((new SoftwareAuthenticator())->sign($authData.$cdh)),
            ],
            // packed, alg differs from the credential key
            'packed, alg mismatch' => static fn (string $authData, string $cdh) => [
                'packed', "\xA2".$text('alg')."\x39\x01\x00".$text('sig').$bytes($a->sign($authData.$cdh)),
            ],
            // "none" must have an empty statement
            'none with statement' => static fn () => ['none', "\xA1".$text('sig').$bytes('x')],
            'unsupported format' => static fn () => ['tpm', "\xA0"],
            'unknown format' => static fn () => ['bogus', "\xA0"],
        ];
        foreach ($rejected as $label => $attStmt) {
            $r = $this->register($user, new SoftwareAuthenticator(), ['attStmt' => $attStmt]);
            $this->assertSame(400, $r['status'], $label);
        }
        $this->assertSame(1, self::$em->getRepository(Passkey::class)->count([]));
    }

    public function testRegistrationRejectsWeakOrUnofferedAlgorithmsAndMissingFlags(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $a = new SoftwareAuthenticator();
        $cose = $a->cosePublicKey();
        // Same key labelled as EdDSA (-8) / ES384 (-35): not offered in pubKeyCredParams.
        foreach (["\x27", "\x38\x22"] as $alg) {
            $r = $this->register($user, new SoftwareAuthenticator(), ['cose' => substr_replace($cose, $alg, 4, 1)]);
            $this->assertSame(400, $r['status']);
        }
        // Without user presence / without attested credential data.
        $this->assertSame(400, $this->register($user, new SoftwareAuthenticator(), ['flags' => SoftwareAuthenticator::FLAG_UV | SoftwareAuthenticator::FLAG_AT])['status']);
        $this->assertSame(400, $this->register($user, new SoftwareAuthenticator(), ['flags' => SoftwareAuthenticator::FLAG_UP | SoftwareAuthenticator::FLAG_UV])['status']);
        $this->assertSame(0, self::$em->getRepository(Passkey::class)->count([]));

        // UV is "preferred" by default: a presence-only authenticator may register.
        $this->assertSame(200, $this->register($user, $a, ['flags' => SoftwareAuthenticator::FLAG_UP | SoftwareAuthenticator::FLAG_AT])['status']);
    }

    public function testRegistrationWithCrossOriginClientDataIsRejected(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $opts = $this->options('register', $user);
        $attestation = (new SoftwareAuthenticator())->attestation($opts['challenge'], self::$origin, self::RP_ID);
        $clientData = json_decode(self::b64decode($attestation['response']['clientDataJSON']), true);
        $attestation['response']['clientDataJSON'] = SoftwareAuthenticator::b64(json_encode(['crossOrigin' => true] + $clientData, \JSON_UNESCAPED_SLASHES));
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/verify', [
            'challengeToken' => $opts['token'], 'response' => $attestation,
        ], $this->auth($user));
        $this->assertSame(400, $r['status']);
    }
}
