<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\MfaBackupCode;
use App\Entity\User;
use App\Entity\UserTotp;
use App\Security\Mfa\BackupCodeGenerator;
use App\Security\Mfa\Totp;
use App\Security\OneTimeTokenService;
use App\Security\SignedTokenService;
use App\Service\TokenService;
use App\Telemetry\LoginMetrics;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\FakeOAuth2Client;
use App\Tests\Helper\SoftwareAuthenticator;
use App\Tests\Helper\TelemetryCapture;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Live `club_calendar.logins` counter: one success per issued session, one failure per evaluated attempt. */
class LoginTelemetryTest extends WebTestCase
{
    use TelemetryCapture;

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private string $secret;

    protected function setUp(): void
    {
        $this->enableTelemetry();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->secret = Totp::generateSecret();
    }

    protected function tearDown(): void
    {
        $this->resetTelemetryEnv();
        parent::tearDown();
        self::ensureKernelShutdown();
    }

    private function user(bool $mfa = false, bool $verified = true): User
    {
        $user = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'alice@example.com', 'password123', $verified);
        if ($mfa) {
            $this->em->persist(new UserTotp($user, $this->secret));
            $user->setMfaEnforced(true);
            $this->em->flush();
        }
        $this->clearPoints();

        return $user;
    }

    private function post(string $uri, array $data): array
    {
        return TestHelper::jsonRequest($this->client, 'POST', $uri, $data);
    }

    private function login(string $password = 'password123', string $email = 'alice@example.com'): array
    {
        return $this->post('/api/auth/login', ['email' => $email, 'password' => $password]);
    }

    /** @return array<string, int|float> "method/stage/success[/provider]" => count, summed over all flushes */
    private function counts(): array
    {
        $out = [];
        foreach ($this->points(LoginMetrics::NAME) as $p) {
            $a = $p['attrs'];
            $key = $a['method'].'/'.$a['stage'].'/'.($a['success'] ? 'ok' : 'fail').(isset($a['provider']) ? '/'.$a['provider'] : '');
            $out[$key] = ($out[$key] ?? 0) + $p['value'];
        }
        ksort($out);

        return $out;
    }

    private function mfaToken(): string
    {
        $r = $this->login();
        $this->assertTrue($r['body']['mfaRequired']);

        return $r['body']['mfaToken'];
    }

    private function verify(string $token, string $method, string $code): array
    {
        return $this->post('/api/auth/mfa/verify', ['mfaToken' => $token, 'method' => $method, 'code' => $code]);
    }

    public function testPasswordSuccess(): void
    {
        $this->user();
        $this->assertSame(200, $this->login()['status']);
        $this->assertSame(['password/primary/ok' => 1], $this->counts());
    }

    public function testRestrictedSessionOfUnverifiedUserCountsAsSuccess(): void
    {
        $this->user(false, false);
        $this->assertSame(200, $this->login()['status']);
        $this->assertSame(['password/primary/ok' => 1], $this->counts());
    }

    public function testWrongPasswordAndUnknownUserAreFailures(): void
    {
        $this->user();
        $this->assertSame(401, $this->login('wrong-password')['status']);
        $this->assertSame(401, $this->login('password123', 'nobody@example.com')['status']);
        $this->assertSame(['password/primary/fail' => 2], $this->counts());
    }

    public function testMalformedRequestCountsNothing(): void
    {
        $this->user();
        $this->assertGreaterThanOrEqual(400, $this->post('/api/auth/login', ['email' => 'alice@example.com'])['status']);
        $this->assertSame([], $this->counts());
    }

    public function testRateLimitedRequestCountsNothing(): void
    {
        $this->user();
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(401, $this->login('wrong-password')['status']);
        }
        $this->assertSame(429, $this->login('wrong-password')['status']);
        $this->assertSame(['password/primary/fail' => 5], $this->counts());
    }

    public function testMfaUserPasswordStepCountsNothingThenTotpIsOneSuccess(): void
    {
        $this->user(true);
        $token = $this->mfaToken();
        $this->assertSame([], $this->counts());

        $r = $this->verify($token, 'totp', Totp::code($this->secret, Totp::step(time())));
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['totp/mfa/ok' => 1], $this->counts());
    }

    public function testWrongTotpIsAnMfaFailure(): void
    {
        $this->user(true);
        $token = $this->mfaToken();
        $this->assertSame(401, $this->verify($token, 'totp', '000000')['status']);
        $this->assertSame(['totp/mfa/fail' => 1], $this->counts());
    }

    public function testBackupCodeSuccessAndFailure(): void
    {
        $user = $this->user(true);
        $generator = static::getContainer()->get(BackupCodeGenerator::class);
        $hasher = static::getContainer()->get('security.password_hasher_factory')->getPasswordHasher('backup_code');
        $codes = $generator->generate();
        foreach ($codes as $code) {
            $this->em->persist(new MfaBackupCode($user, $hasher->hash($generator->normalize($code))));
        }
        $this->em->flush();

        $token = $this->mfaToken();
        $this->assertSame(401, $this->verify($token, 'backup_code', 'AAAA-AAAA-AAAA')['status']);
        $this->assertSame(200, $this->verify($token, 'backup_code', $codes[0])['status']);
        $this->assertSame(['backup_code/mfa/fail' => 1, 'backup_code/mfa/ok' => 1], $this->counts());
    }

    public function testMfaPasskeyFailureAndSuccess(): void
    {
        $user = $this->user(true);
        $origin = rtrim((string) $_ENV['FRONTEND_URL'], '/');
        [$auth, $stepUp] = TestHelper::stepUpSessionSkippingMfa($this->client, $user, static::getContainer()->get(TokenService::class), $this->em);
        $o = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/webauthn/register/options', [], $auth, $stepUp);
        $key = new SoftwareAuthenticator();
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/webauthn/register/verify', [
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $key->attestation($o['body']['options']['challenge'], $origin, 'localhost'),
            'deviceName' => 'Software',
        ], $auth, $stepUp);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->clearPoints();

        $token = $this->mfaToken();
        $o = $this->post('/api/auth/mfa/passkey/options', ['mfaToken' => $token]);
        $other = new SoftwareAuthenticator();
        $bad = $this->post('/api/auth/mfa/passkey/verify', [
            'mfaToken' => $token,
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $other->assertion($o['body']['options']['challenge'], $origin, 'localhost', $user->getId()),
        ]);
        $this->assertSame(401, $bad['status']);
        $o = $this->post('/api/auth/mfa/passkey/options', ['mfaToken' => $token]);
        $ok = $this->post('/api/auth/mfa/passkey/verify', [
            'mfaToken' => $token,
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $key->assertion($o['body']['options']['challenge'], $origin, 'localhost', $user->getId()),
        ]);
        $this->assertSame(200, $ok['status'], $ok['content']);
        $this->assertSame(['passkey/mfa/fail' => 1, 'passkey/mfa/ok' => 1], $this->counts());
    }

    public function testPasskeySignIn(): void
    {
        $user = $this->user();
        $origin = rtrim((string) $_ENV['FRONTEND_URL'], '/');
        [$auth, $stepUp] = TestHelper::stepUpSessionSkippingMfa($this->client, $user, static::getContainer()->get(TokenService::class), $this->em);
        $o = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/webauthn/register/options', [], $auth, $stepUp);
        $key = new SoftwareAuthenticator();
        TestHelper::jsonRequest($this->client, 'POST', '/api/auth/webauthn/register/verify', [
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $key->attestation($o['body']['options']['challenge'], $origin, 'localhost'),
            'deviceName' => 'Software',
        ], $auth, $stepUp);
        $this->clearPoints();

        $attempt = function (SoftwareAuthenticator $by) use ($origin, $user): int {
            $this->client->request('GET', '/api/auth/webauthn/authenticate/options');
            $opts = json_decode((string) $this->client->getResponse()->getContent(), true);

            return $this->post('/api/auth/webauthn/authenticate/verify', [
                'challengeToken' => $opts['challengeToken'],
                'response' => $by->assertion($opts['options']['challenge'], $origin, 'localhost', $user->getId()),
            ])['status'];
        };
        $this->assertSame(401, $attempt(new SoftwareAuthenticator()));
        $this->assertSame(200, $attempt($key));
        $this->assertSame(['passkey/primary/fail' => 1, 'passkey/primary/ok' => 1], $this->counts());
    }

    public function testSsoCountsOnlyAtRedemption(): void
    {
        $this->user();
        $fake = new FakeOAuth2Client();
        static::getContainer()->set('knpu.oauth2.client.google', $fake);
        $verifier = SignedTokenService::b64(random_bytes(32));
        $this->client->request('GET', 'https://localhost/api/auth/oauth/google?'.http_build_query(['code_challenge' => OneTimeTokenService::challengeFor($verifier)]));
        parse_str((string) parse_url((string) $this->client->getResponse()->headers->get('Location'), \PHP_URL_QUERY), $q);
        $fake->claims = ['sub' => 'g-1', 'email' => 'alice@example.com', 'email_verified' => true, 'name' => 'A'];
        $this->client->request('GET', 'https://localhost/api/auth/oauth/google/callback?'.http_build_query(['code' => 'c', 'state' => $q['state']]));
        parse_str((string) parse_url((string) $this->client->getResponse()->headers->get('Location'), \PHP_URL_QUERY), $result);
        $this->assertNotEmpty($result['code']);
        $this->assertSame([], $this->counts(), 'the provider callback only issues the code');

        $this->client->request('POST', '/api/auth/token', ['grant_type' => 'one_time_token', 'token' => $result['code'], 'code_verifier' => $verifier]);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());
        $this->assertSame(['sso/primary/ok/google' => 1], $this->counts());

        // spent code
        $this->client->request('POST', '/api/auth/token', ['grant_type' => 'one_time_token', 'token' => $result['code'], 'code_verifier' => $verifier]);
        $this->assertSame(400, $this->client->getResponse()->getStatusCode());
        $this->assertSame(['sso/primary/fail/none' => 1, 'sso/primary/ok/google' => 1], $this->counts());
    }

    public function testSsoIdentityConflictIsAFailureWithProvider(): void
    {
        $this->user();
        $fake = new FakeOAuth2Client();
        static::getContainer()->set('knpu.oauth2.client.microsoft', $fake);
        $verifier = SignedTokenService::b64(random_bytes(32));
        $this->client->request('GET', 'https://localhost/api/auth/oauth/microsoft?'.http_build_query(['code_challenge' => OneTimeTokenService::challengeFor($verifier)]));
        parse_str((string) parse_url((string) $this->client->getResponse()->headers->get('Location'), \PHP_URL_QUERY), $q);
        $fake->claims = ['sub' => 'ms-1', 'email' => 'alice@example.com', 'name' => 'A'];
        $this->client->request('GET', 'https://localhost/api/auth/oauth/microsoft/callback?'.http_build_query(['code' => 'c', 'state' => $q['state']]));
        $this->assertStringContainsString('error=account_exists', (string) $this->client->getResponse()->headers->get('Location'));
        $this->assertSame(['sso/primary/fail/microsoft' => 1], $this->counts());
    }

    public function testDisabledTelemetryChangesNoBehaviour(): void
    {
        $this->resetTelemetryEnv();
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->user();
        $this->assertSame(200, $this->login()['status']);
        $this->assertSame(401, $this->login('wrong')['status']);
        $this->assertSame([], $this->counts());
    }
}
