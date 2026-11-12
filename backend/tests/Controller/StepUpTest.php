<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\MfaBackupCode;
use App\Entity\User;
use App\Entity\UserTotp;
use App\Security\Mfa\BackupCodeGenerator;
use App\Security\Mfa\Totp;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\SoftwareAuthenticator;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Step-up confirmation: token issuing, factor handling, binding and #[RequiresStepUp] enforcement. */
class StepUpTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const string RP_ID = 'localhost';
    private const string PROBE = '/api/__test/step-up-probe';

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private string $secret;

    protected function setUp(): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->secret = Totp::generateSecret();
    }

    protected function tearDown(): void
    {
        self::mockTime();
        parent::tearDown();
    }

    private function user(string $email = 'alice@example.com', bool $mfa = false, bool $verified = true): User
    {
        $user = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), $email, 'password123', $verified);
        if ($mfa) {
            $this->em->persist(new UserTotp($user, $this->secret));
            $user->setMfaEnforced(true);
            $this->em->flush();
        }

        return $user;
    }

    /** @return list<string> */
    private function backupCodes(User $user): array
    {
        $generator = static::getContainer()->get(BackupCodeGenerator::class);
        $hasher = static::getContainer()->get('security.password_hasher_factory')->getPasswordHasher('backup_code');
        $codes = $generator->generate();
        foreach ($codes as $code) {
            $this->em->persist(new MfaBackupCode($user, $hasher->hash($generator->normalize($code))));
        }
        $this->em->flush();

        return $codes;
    }

    /** A new session (own refresh-token family); returns the Authorization header. */
    private function session(User $user): string
    {
        return 'Bearer '.static::getContainer()->get(TokenService::class)->tokenResponse($user)['access_token'];
    }

    private function totp(int $offset = 0): string
    {
        return Totp::code($this->secret, Totp::step(time()) + $offset);
    }

    private function post(string $uri, array $data, string $auth): array
    {
        return TestHelper::jsonRequest($this->client, 'POST', $uri, $data, $auth);
    }

    private function probe(string $auth, ?string $stepUp): array
    {
        $headers = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => $auth];
        if (null !== $stepUp) {
            $headers['HTTP_X_STEP_UP_TOKEN'] = $stepUp;
        }
        $this->client->request('GET', self::PROBE, [], [], $headers);
        $content = (string) $this->client->getResponse()->getContent();

        return ['status' => $this->client->getResponse()->getStatusCode(), 'body' => json_decode($content, true), 'content' => $content];
    }

    private function stepUp(string $auth, array $data): string
    {
        $r = $this->post('/api/auth/step-up', $data, $auth);
        $this->assertSame(200, $r['status'], $r['content']);

        return $r['body']['stepUpToken'];
    }

    /** @return list<array<string, mixed>> */
    private function events(string $type): array
    {
        return static::getContainer()->get(Connection::class)->fetchAllAssociative('SELECT * FROM security_event WHERE type = ? ORDER BY created_at, id', [$type]);
    }

    /** @return array{0: SoftwareAuthenticator, 1: string} */
    private function passkeyFor(User $user): array
    {
        $origin = rtrim((string) $_ENV['FRONTEND_URL'], '/');
        $auth = $this->session($user);
        $o = $this->post('/api/auth/webauthn/register/options', ['password' => 'password123'], $auth);
        $authenticator = new SoftwareAuthenticator();
        $r = $this->post('/api/auth/webauthn/register/verify', [
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $authenticator->attestation($o['body']['options']['challenge'], $origin, self::RP_ID),
            'deviceName' => 'Software',
        ], $auth);
        $this->assertSame(200, $r['status'], $r['content']);

        return [$authenticator, $origin];
    }

    public function testPasswordOnlyWithoutMfa(): void
    {
        $user = $this->user();
        $auth = $this->session($user);

        $denied = $this->probe($auth, null);
        $this->assertSame(403, $denied['status']);
        $this->assertSame('step_up_required', $denied['body']['code']);
        $this->assertSame(['password' => true, 'mfa' => []], $denied['body']['methods']);

        $r = $this->post('/api/auth/step-up', ['password' => 'password123'], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(600, $r['body']['expiresIn']);
        $this->assertSame(200, $this->probe($auth, $r['body']['stepUpToken'])['status']);
        $this->assertSame('password', $this->events('step_up')[0]['method']);
        $this->assertSame(1, (int) $this->events('step_up')[0]['success']);
    }

    public function testWrongPasswordAndMalformedBodies(): void
    {
        $auth = $this->session($this->user());

        $r = $this->post('/api/auth/step-up', ['password' => 'nope'], $auth);
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_credentials', $r['body']['code']);
        $this->assertSame('password', $r['body']['field']);
        $failed = $this->events('step_up');
        $this->assertSame(0, (int) $failed[0]['success']);
        $this->assertSame('password', $failed[0]['method']);

        $this->assertSame(400, $this->post('/api/auth/step-up', [], $auth)['status']);
        $this->assertSame(400, $this->post('/api/auth/step-up', ['password' => ['x']], $auth)['status']);
        $bad = $this->post('/api/auth/step-up', ['password' => 'password123', 'factor' => ['method' => 'sms', 'code' => '1']], $auth);
        $this->assertSame('invalid_request', $bad['body']['code']);
    }

    public function testRoutesNeedASignedInUser(): void
    {
        $this->assertSame(401, $this->post('/api/auth/step-up', ['password' => 'password123'], '')['status']);
        $this->assertSame(401, $this->post('/api/auth/step-up/code', [], '')['status']);
        $this->assertSame(401, $this->post('/api/auth/step-up/passkey/options', [], '')['status']);
    }

    public function testMissingFactorWhenMfaIsOn(): void
    {
        $user = $this->user('alice@example.com', true);
        $this->backupCodes($user);
        $auth = $this->session($user);

        $r = $this->post('/api/auth/step-up', ['password' => 'password123'], $auth);
        $this->assertSame(422, $r['status']);
        $this->assertSame('mfa_factor_required', $r['body']['code']);

        $denied = $this->probe($auth, null);
        $this->assertSame(['password' => true, 'mfa' => ['totp', 'backup_code']], $denied['body']['methods']);
        // the password is checked first
        $this->assertSame('invalid_credentials', $this->post('/api/auth/step-up', ['password' => 'x', 'factor' => ['method' => 'totp', 'code' => $this->totp()]], $auth)['body']['code']);
    }

    public function testTotpFactorAndReplay(): void
    {
        $user = $this->user('alice@example.com', true);
        $auth = $this->session($user);
        $code = $this->totp();

        $token = $this->stepUp($auth, ['password' => 'password123', 'factor' => ['method' => 'totp', 'code' => $code]]);
        $this->assertSame(200, $this->probe($auth, $token)['status']);
        $this->assertSame('totp', $this->events('step_up')[0]['method']);

        $replay = $this->post('/api/auth/step-up', ['password' => 'password123', 'factor' => ['method' => 'totp', 'code' => $code]], $auth);
        $this->assertSame(422, $replay['status']);
        $this->assertSame('invalid_mfa_code', $replay['body']['code']);
        $this->assertSame('code', $replay['body']['field']);
    }

    public function testBackupCodeIsConsumedAndMailedWithoutEndingSessions(): void
    {
        $user = $this->user('alice@example.com', true);
        $codes = $this->backupCodes($user);
        $auth = $this->session($user);
        $other = $this->session($user);

        $r = $this->post('/api/auth/step-up', ['password' => 'password123', 'factor' => ['method' => 'backup_code', 'code' => strtolower($codes[0])]], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertCount(1, array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email));
        $this->assertTrue($r['body']['backupCodeUsed']);
        $this->assertSame(9, $r['body']['backupCodesRemaining']);
        $this->assertSame(200, $this->probe($auth, $r['body']['stepUpToken'])['status']);
        $this->assertSame(200, TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], $other)['status']);
        $this->assertCount(1, $this->events('backup_code_used'));
        $this->assertSame('backup_code', $this->events('step_up')[0]['method']);
        $this->em->clear();
        $this->assertTrue($this->em->getRepository(User::class)->find($user->getId())->isMfaEnforced());

        $again = $this->post('/api/auth/step-up', ['password' => 'password123', 'factor' => ['method' => 'backup_code', 'code' => $codes[0]]], $auth);
        $this->assertSame('invalid_mfa_code', $again['body']['code']);
    }

    public function testPasskeyFactor(): void
    {
        $user = $this->user('alice@example.com', true);
        [$authenticator, $origin] = $this->passkeyFor($user);
        $auth = $this->session($user);

        $o = $this->post('/api/auth/step-up/passkey/options', [], $auth);
        $this->assertSame(200, $o['status'], $o['content']);
        $this->assertCount(1, $o['body']['options']['allowCredentials']);

        // the MFA sign-in challenge is another purpose
        $bad = $this->post('/api/auth/step-up', ['password' => 'password123', 'factor' => [
            'method' => 'passkey',
            'challengeToken' => $o['body']['challengeToken'],
            'response' => (new SoftwareAuthenticator())->assertion($o['body']['options']['challenge'], $origin, self::RP_ID, $user->getId()),
        ]], $auth);
        $this->assertSame(422, $bad['status']);
        $this->assertSame('invalid_passkey', $bad['body']['code']);

        $o = $this->post('/api/auth/step-up/passkey/options', [], $auth);
        $token = $this->stepUp($auth, ['password' => 'password123', 'factor' => [
            'method' => 'passkey',
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $authenticator->assertion($o['body']['options']['challenge'], $origin, self::RP_ID, $user->getId()),
        ]]);
        $this->assertSame(200, $this->probe($auth, $token)['status']);
        $this->assertSame('passkey', $this->events('step_up')[1]['method']);
        $this->assertSame(['password' => true, 'mfa' => ['totp', 'backup_code', 'passkey']], $this->probe($auth, null)['body']['methods']);
    }

    public function testPasskeyOnlyMfaAndOptionsNeedAPasskey(): void
    {
        $user = $this->user();
        $this->assertSame(400, $this->post('/api/auth/step-up/passkey/options', [], $this->session($user))['status']);

        [$authenticator, $origin] = $this->passkeyFor($user);
        $em = static::getContainer()->get(EntityManagerInterface::class);
        $em->getConnection()->executeStatement('UPDATE user SET mfa_enforced = 1');
        $em->clear();
        $user = $em->getRepository(User::class)->find($user->getId());
        $auth = $this->session($user);
        $o = $this->post('/api/auth/step-up/passkey/options', [], $auth);
        $this->stepUp($auth, ['password' => 'password123', 'factor' => [
            'method' => 'passkey',
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $authenticator->assertion($o['body']['options']['challenge'], $origin, self::RP_ID, $user->getId()),
        ]]);
        $this->assertSame(['password' => true, 'mfa' => ['backup_code', 'passkey']], $this->probe($auth, null)['body']['methods']);
    }

    public function testFailuresShareOneBudgetWithTheMfaSignIn(): void
    {
        $user = $this->user('alice@example.com', true);
        $auth = $this->session($user);
        $wrong = ['password' => 'password123', 'factor' => ['method' => 'totp', 'code' => '000000']];

        for ($i = 0; $i < 3; ++$i) {
            $login = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'alice@example.com', 'password' => 'password123']);
            $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/mfa/verify', ['mfaToken' => $login['body']['mfaToken'], 'method' => 'totp', 'code' => '000000']);
            $this->assertSame(401, $r['status']);
        }
        for ($i = 0; $i < 2; ++$i) {
            $this->assertSame('invalid_mfa_code', $this->post('/api/auth/step-up', $wrong, $auth)['body']['code']);
        }
        $locked = $this->post('/api/auth/step-up', $wrong, $auth);
        $this->assertSame(429, $locked['status']);
        $this->assertSame('rate_limited', $locked['body']['code']);
        $this->assertNotNull($this->client->getResponse()->headers->get('Retry-After'));
        // even the right code is refused without being evaluated
        $good = $this->post('/api/auth/step-up', ['password' => 'password123', 'factor' => ['method' => 'totp', 'code' => $this->totp()]], $auth);
        $this->assertSame(429, $good['status']);
        // and the sign-in is locked by the step-up failures too
        $login = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'alice@example.com', 'password' => 'password123']);
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/mfa/verify', ['mfaToken' => $login['body']['mfaToken'], 'method' => 'totp', 'code' => $this->totp()]);
        $this->assertSame(429, $r['status']);
        $this->assertSame(2, (int) array_sum(array_column(array_filter($this->events('step_up'), fn ($e) => 0 === (int) $e['success']), 'attempts')));
    }

    public function testPasswordlessAccountUsesTheMailedCode(): void
    {
        $user = $this->user();
        $user->setPassword(null);
        $this->em->flush();
        $auth = $this->session($user);

        $this->assertSame(['password' => false, 'mfa' => []], $this->probe($auth, null)['body']['methods']);
        $bad = $this->post('/api/auth/step-up', ['confirmationCode' => '000000'], $auth);
        $this->assertSame(400, $bad['status']);
        $this->assertSame('invalid_confirmation_code', $bad['body']['code']);

        $this->assertSame(204, $this->post('/api/auth/step-up/code', [], $auth)['status']);
        $this->assertEmailCount(1);
        $mail = $this->getMailerMessage();
        $this->assertInstanceOf(Email::class, $mail);
        $this->assertSame(1, preg_match('/letter-spacing:\d+px[^>]*>(\d{3})-(\d{3})</', (string) $mail->getHtmlBody(), $m));

        // a code of another purpose is no good, the right one is
        $token = $this->stepUp($auth, ['confirmationCode' => $m[1].$m[2]]);
        $this->assertSame(200, $this->probe($auth, $token)['status']);
        $this->assertSame('code', $this->events('step_up')[1]['method']);
    }

    public function testCodeRouteIsOnlyForAccountsWithoutPassword(): void
    {
        $r = $this->post('/api/auth/step-up/code', [], $this->session($this->user()));
        $this->assertSame(409, $r['status']);
        $this->assertSame('has_password', $r['body']['code']);
    }

    public function testTokenIsBoundToUserAndSession(): void
    {
        $alice = $this->user();
        $bob = $this->user('bob@example.com');
        $aliceAuth = $this->session($alice);
        $token = $this->stepUp($aliceAuth, ['password' => 'password123']);

        $this->assertSame('step_up_required', $this->probe($this->session($bob), $token)['body']['code']);
        $this->assertSame('step_up_required', $this->probe($this->session($alice), $token)['body']['code'], 'another session of the same user');
        $this->assertSame(200, $this->probe($aliceAuth, $token)['status']);
        $this->assertSame('step_up_required', $this->probe($aliceAuth, $token.'x')['body']['code']);
        $this->assertSame('step_up_required', $this->probe($aliceAuth, 'garbage')['body']['code']);
    }

    public function testTokenDiesWhenTheTokenVersionChanges(): void
    {
        $user = $this->user();
        $tokens = static::getContainer()->get(TokenService::class);
        $pair = $tokens->tokenResponse($user);
        $auth = 'Bearer '.$pair['access_token'];
        $family = $tokens->decodeRefreshToken($pair['refresh_token'])['fam'];
        $token = $this->stepUp($auth, ['password' => 'password123']);

        $logout = $this->post('/api/auth/logout-all', [], $auth);
        $this->assertSame(204, $logout['status'], $logout['content']);
        $this->assertSame(401, $this->probe($auth, $token)['status']);
        // a fresh access token of the same family (as a refresh would give) does not revive it
        $this->em->clear();
        $fresh = $this->em->getRepository(User::class)->find($user->getId());
        $revived = 'Bearer '.$tokens->createAccessToken($fresh, true, $family);
        $this->assertSame('step_up_required', $this->probe($revived, $token)['body']['code']);
    }

    public function testTokenExpiresAfterTenMinutes(): void
    {
        self::mockTime();
        $auth = $this->session($this->user());
        $token = $this->stepUp($auth, ['password' => 'password123']);

        self::mockTime('+599 seconds');
        $this->assertSame(200, $this->probe($auth, $token)['status']);
        self::mockTime('+3 seconds');
        $this->assertSame('step_up_required', $this->probe($auth, $token)['body']['code']);
    }

    public function testTokenIsNeitherABearerNorAnMfaToken(): void
    {
        $user = $this->user('alice@example.com', true);
        $auth = $this->session($user);
        $token = $this->stepUp($auth, ['password' => 'password123', 'factor' => ['method' => 'totp', 'code' => $this->totp()]]);

        $this->assertSame(401, TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], 'Bearer '.$token)['status']);
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/mfa/verify', ['mfaToken' => $token, 'method' => 'totp', 'code' => $this->totp(1)]);
        $this->assertSame('invalid_mfa_token', $r['body']['code']);
        // a sign-in mfaToken is no step-up token either
        $login = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'alice@example.com', 'password' => 'password123']);
        $this->assertSame('step_up_required', $this->probe($auth, $login['body']['mfaToken'])['body']['code']);
    }

    public function testSessionWithoutFamilyClaimGetsStepUpUnavailable(): void
    {
        $user = $this->user();
        $auth = 'Bearer '.static::getContainer()->get(TokenService::class)->createAccessToken($user);

        $r = $this->post('/api/auth/step-up', ['password' => 'password123'], $auth);
        $this->assertSame(403, $r['status']);
        $this->assertSame('step_up_unavailable', $r['body']['code']);
        $this->assertSame('step_up_unavailable', $this->probe($auth, 'x')['body']['code']);
        $this->assertSame('step_up_unavailable', $this->post('/api/auth/step-up/passkey/options', [], $auth)['body']['code']);
    }

    public function testGatesWinOverTheStepUp(): void
    {
        $auth = $this->session($this->user('new@example.com', false, false));

        $this->assertSame('email_verification_required', $this->probe($auth, null)['body']['code']);
        $this->assertSame('email_verification_required', $this->post('/api/auth/step-up', ['password' => 'password123'], $auth)['body']['code']);
    }
}
