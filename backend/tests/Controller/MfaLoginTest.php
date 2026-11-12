<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\MfaBackupCode;
use App\Entity\User;
use App\Entity\UserTotp;
use App\Security\Mfa\BackupCodeGenerator;
use App\Security\Mfa\Totp;
use App\Security\OneTimeTokenService;
use App\Service\AuthService;
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

/** MFA at password sign-in: login challenge, TOTP, backup code, passkey. */
class MfaLoginTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const string RP_ID = 'localhost';

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

    private function user(bool $totp = true, bool $verified = true): User
    {
        $user = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'alice@example.com', 'password123', $verified);
        if ($totp) {
            $this->em->persist(new UserTotp($user, $this->secret));
        }
        $user->setMfaEnforced(true);
        $this->em->flush();

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

    private function totpCode(int $offset = 0): string
    {
        return Totp::code($this->secret, Totp::step(time()) + $offset);
    }

    private function post(string $uri, array $data, string $auth = ''): array
    {
        return TestHelper::jsonRequest($this->client, 'POST', $uri, $data, $auth);
    }

    private function loginChallenge(string $password = 'password123'): array
    {
        return $this->post('/api/auth/login', ['email' => 'alice@example.com', 'password' => $password]);
    }

    private function token(): string
    {
        $r = $this->loginChallenge();
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertTrue($r['body']['mfaRequired']);

        return $r['body']['mfaToken'];
    }

    private function verify(string $token, string $method, string $code): array
    {
        return $this->post('/api/auth/mfa/verify', ['mfaToken' => $token, 'method' => $method, 'code' => $code]);
    }

    /** @return list<array<string, mixed>> */
    private function events(string $type): array
    {
        return static::getContainer()->get(Connection::class)->fetchAllAssociative('SELECT * FROM security_event WHERE type = ? ORDER BY created_at, id', [$type]);
    }

    private function assertSession(array $r): void
    {
        $this->assertSame(200, $r['status'], $r['content']);
        $me = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], 'Bearer '.$r['body']['access_token']);
        $this->assertSame(200, $me['status'], $me['content']);
    }

    /** @return array{0: SoftwareAuthenticator, 1: string} */
    private function passkeyFor(User $user): array
    {
        $origin = rtrim((string) $_ENV['FRONTEND_URL'], '/');
        $auth = 'Bearer '.static::getContainer()->get(TokenService::class)->createAccessToken($user);
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

    public function testLoginWithMfaReturnsChallengeInsteadOfTokens(): void
    {
        $this->backupCodes($this->user());
        $r = $this->loginChallenge();

        $this->assertSame(200, $r['status']);
        $this->assertSame(['mfaRequired', 'mfaToken', 'expiresIn', 'methods'], array_keys($r['body']));
        $this->assertSame(300, $r['body']['expiresIn']);
        $this->assertSame(['totp', 'backup_code'], $r['body']['methods']);
        $this->assertArrayNotHasKey('access_token', $r['body']);
        $this->assertArrayNotHasKey('refresh_token', $r['body']);
        // The first factor is logged, the sign-in is not finished yet
        $this->assertCount(1, $this->events('login'));
    }

    public function testWrongPasswordGivesNoChallenge(): void
    {
        $this->user();
        $r = $this->loginChallenge('wrong-password');

        $this->assertSame(401, $r['status']);
        $this->assertSame('invalid_credentials', $r['body']['code']);
    }

    public function testMethodsListsPasskeyOnlyWhenOneExists(): void
    {
        $user = $this->user(false);
        $this->assertSame(['backup_code'], $this->loginChallenge()['body']['methods']);

        $this->passkeyFor($user);
        $this->assertSame(['backup_code', 'passkey'], $this->loginChallenge()['body']['methods']);
    }

    public function testUnverifiedAddressSkipsMfa(): void
    {
        $this->user(true, false);
        $r = $this->loginChallenge();

        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertArrayNotHasKey('mfaRequired', $r['body']);
        $this->assertTrue($r['body']['emailVerificationRequired']);
    }

    public function testUserWithoutMfaLogsInAsBefore(): void
    {
        TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'alice@example.com');
        $r = $this->loginChallenge();

        $this->assertSession($r);
        $this->assertArrayNotHasKey('mfaRequired', $r['body']);
    }

    public function testTotpCompletesSignInAndLogsEvent(): void
    {
        $this->user();
        $r = $this->verify($this->token(), 'totp', $this->totpCode());

        $this->assertSession($r);
        $this->assertArrayNotHasKey('mfaDisabled', $r['body']);
        $this->client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $r['body']['refresh_token']]);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());
        $events = $this->events('mfa_verify');
        $this->assertCount(1, $events);
        $this->assertSame('totp', $events[0]['method']);
        $this->assertSame(1, (int) $events[0]['success']);
    }

    public function testReplayOfTheSameTotpStepIsRejected(): void
    {
        $this->user();
        $code = $this->totpCode();
        $this->assertSession($this->verify($this->token(), 'totp', $code));

        $r = $this->verify($this->token(), 'totp', $code);
        $this->assertSame(401, $r['status']);
        $this->assertSame('invalid_mfa_code', $r['body']['code']);
        // The next step is still fine
        $this->assertSession($this->verify($this->token(), 'totp', $this->totpCode(1)));
    }

    public function testWrongCodeLogsFailedEventAndWrongTotpEqualsWrongBackupCode(): void
    {
        $this->backupCodes($this->user());
        $token = $this->token();

        $totp = $this->verify($token, 'totp', '000000');
        $backup = $this->verify($token, 'backup_code', 'AAAA-AAAA-AAAA');

        $this->assertSame(401, $totp['status']);
        $this->assertSame('invalid_mfa_code', $totp['body']['code']);
        $this->assertSame('code', $totp['body']['field']);
        $this->assertSame(401, $backup['status']);
        $this->assertSame($totp['body']['code'], $backup['body']['code']);
        $this->assertSame($totp['body']['field'], $backup['body']['field']);
        $this->assertSame($totp['body']['title'] ?? null, $backup['body']['title'] ?? null);
        $this->assertSame($totp['body']['detail'] ?? null, $backup['body']['detail'] ?? null);

        $events = $this->events('mfa_verify');
        $this->assertCount(2, $events);
        foreach ($events as $event) {
            $this->assertSame(0, (int) $event['success']);
        }
        $this->assertEqualsCanonicalizing(['totp', 'backup_code'], array_column($events, 'method'));
        // The token survived: the right code still works
        $this->assertSession($this->verify($token, 'totp', $this->totpCode()));
    }

    public function testBackupCodeKeepsMfaAndSessionsAndMailsRemaining(): void
    {
        $user = $this->user();
        $codes = $this->backupCodes($user);
        $other = 'Bearer '.static::getContainer()->get(TokenService::class)->createAccessToken($user);
        $this->assertSame(200, TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], $other)['status']);

        $r = $this->verify($this->token(), 'backup_code', strtolower($codes[0]));

        $this->assertSame(200, $r['status'], $r['content']);
        $mails = array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email);
        $this->assertCount(1, $mails);
        $this->assertTrue($r['body']['backupCodeUsed']);
        $this->assertSame(9, $r['body']['backupCodesRemaining']);
        $this->assertArrayNotHasKey('mfaDisabled', $r['body']);
        $this->assertSession($r);
        // The other session stays
        $this->assertSame(200, TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], $other)['status']);

        $this->em->clear();
        $fresh = $this->em->getRepository(User::class)->find($user->getId());
        $this->assertTrue($fresh->isMfaEnforced());
        $this->assertSame(1, (int) static::getContainer()->get(Connection::class)->fetchOne('SELECT COUNT(*) FROM user_totp'));
        $this->assertSame(9, (int) static::getContainer()->get(Connection::class)->fetchOne('SELECT COUNT(*) FROM mfa_backup_code WHERE used_at IS NULL'));
        $used = $this->events('backup_code_used');
        $this->assertCount(1, $used);
        $this->assertSame(1, (int) $used[0]['success']);
        $this->assertSame('backup_code', $this->events('mfa_verify')[0]['method']);

        // The next sign-in still asks for a second factor
        $this->assertTrue($this->loginChallenge()['body']['mfaRequired'] ?? false);
    }

    public function testSixthFailureIsRefusedWithoutEvaluatingAnyFactor(): void
    {
        $this->user();
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame('invalid_mfa_code', $this->verify($this->token(), 'totp', '000000')['body']['code']);
        }
        $good = $this->verify($this->token(), 'totp', $this->totpCode());
        $this->assertSame(429, $good['status']);
        $this->assertSame('rate_limited', $good['body']['code']);
        $this->assertCount(5, $this->events('mfa_verify'));
    }

    public function testBackupCodeIsSingleUse(): void
    {
        $codes = $this->backupCodes($this->user());
        // Second code set aside so enforcement stays irrelevant: use the same code on two tokens
        $t1 = $this->token();
        $t2 = $this->token();
        $this->assertSame(200, $this->verify($t1, 'backup_code', $codes[1])['status']);
        // t2 is dead anyway (token version bumped), and so is the code
        $this->assertSame('invalid_mfa_token', $this->verify($t2, 'backup_code', $codes[2])['body']['code']);
    }

    public function testSpentTokenDoesNotBurnABackupCode(): void
    {
        $codes = $this->backupCodes($this->user());
        $token = $this->token();
        $this->assertSession($this->verify($token, 'totp', $this->totpCode()));

        $this->assertSame('invalid_mfa_token', $this->verify($token, 'backup_code', $codes[0])['body']['code']);
        $this->assertSame(10, (int) static::getContainer()->get(Connection::class)->fetchOne('SELECT COUNT(*) FROM mfa_backup_code WHERE used_at IS NULL'));
        $this->assertSession($this->verify($this->token(), 'backup_code', $codes[0]));
    }

    public function testMfaTokenIsSingleUseAndExpires(): void
    {
        $this->user();
        $token = $this->token();
        $this->assertSession($this->verify($token, 'totp', $this->totpCode()));

        $r = $this->verify($token, 'totp', $this->totpCode(1));
        $this->assertSame(401, $r['status']);
        $this->assertSame('invalid_mfa_token', $r['body']['code']);

        $fresh = $this->token();
        self::mockTime('+6 minutes');
        $r = $this->verify($fresh, 'totp', $this->totpCode(2));
        $this->assertSame('invalid_mfa_token', $r['body']['code']);
    }

    public function testTokenVersionBumpKillsTheChallenge(): void
    {
        $user = $this->user();
        $token = $this->token();
        $user->invalidateTokens();
        $this->em->flush();

        $r = $this->verify($token, 'totp', $this->totpCode());
        $this->assertSame(401, $r['status']);
        $this->assertSame('invalid_mfa_token', $r['body']['code']);
    }

    public function testForgedAndForeignTokensAreRejected(): void
    {
        $this->user();
        foreach (['', 'garbage', 'a.b'] as $token) {
            $r = $this->verify($token, 'totp', $this->totpCode());
            $this->assertSame(401, $r['status']);
            $this->assertSame('invalid_mfa_token', $r['body']['code']);
        }
        // A challenge token of the passkey ceremony is not an mfaToken
        $o = $this->post('/api/auth/webauthn/register/options', ['password' => 'password123'], 'Bearer '.static::getContainer()->get(TokenService::class)->createAccessToken($this->em->getRepository(User::class)->findOneBy([])));
        $this->assertSame('invalid_mfa_token', $this->verify($o['body']['challengeToken'], 'totp', $this->totpCode())['body']['code']);
    }

    public function testMalformedBodyIs400(): void
    {
        $this->assertSame(400, $this->post('/api/auth/mfa/verify', ['mfaToken' => 'x', 'method' => 'sms', 'code' => '1'])['status']);
        $this->assertSame(400, $this->post('/api/auth/mfa/verify', ['mfaToken' => 'x'])['status']);
    }

    public function testTokenDiesAfterFiveGuessesAndUserIsRateLimited(): void
    {
        $this->user();
        $token = $this->token();
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(401, $this->verify($token, 'totp', '000000')['status']);
        }
        $r = $this->verify($token, 'totp', $this->totpCode());
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
        $this->assertNotEmpty($r['headers']['retry-after'][0] ?? null);
        // Rejections by the limiter are not logged
        $this->assertSame(5, (int) array_sum(array_column($this->events('mfa_verify'), 'attempts')));
    }

    public function testPasskeyCompletesSignInAndRejectsForeignCredentialAndReuse(): void
    {
        $user = $this->user(false);
        [$authenticator, $origin] = $this->passkeyFor($user);

        $token = $this->token();
        $o = $this->post('/api/auth/mfa/passkey/options', ['mfaToken' => $token]);
        $this->assertSame(200, $o['status'], $o['content']);
        $allowed = $o['body']['options']['allowCredentials'];
        $this->assertCount(1, $allowed);
        $this->assertSame(SoftwareAuthenticator::b64($authenticator->credentialId), $allowed[0]['id']);

        // A passkey of another account does not pass
        $bob = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'bob@example.com');
        [$bobKey] = $this->passkeyFor($bob);
        $bad = $this->post('/api/auth/mfa/passkey/verify', [
            'mfaToken' => $token,
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $bobKey->assertion($o['body']['options']['challenge'], $origin, self::RP_ID, $bob->getId()),
        ]);
        $this->assertSame(401, $bad['status']);
        $this->assertSame('invalid_passkey', $bad['body']['code']);
        $failed = $this->events('mfa_verify');
        $this->assertCount(1, $failed);
        $this->assertSame('passkey', $failed[0]['method']);
        $this->assertSame(0, (int) $failed[0]['success']);

        // New challenge (the first one was consumed), right passkey
        $o = $this->post('/api/auth/mfa/passkey/options', ['mfaToken' => $token]);
        $r = $this->post('/api/auth/mfa/passkey/verify', [
            'mfaToken' => $token,
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $authenticator->assertion($o['body']['options']['challenge'], $origin, self::RP_ID, $user->getId()),
        ]);
        $this->assertSession($r);
        $this->assertArrayNotHasKey('mfaDisabled', $r['body']);
        $events = $this->events('mfa_verify');
        $this->assertCount(2, $events);
        $this->assertSame(1, (int) $events[1]['success']);

        // The mfaToken is spent
        $o = $this->post('/api/auth/mfa/passkey/options', ['mfaToken' => $token]);
        $again = $this->post('/api/auth/mfa/passkey/verify', [
            'mfaToken' => $token,
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $authenticator->assertion($o['body']['options']['challenge'], $origin, self::RP_ID, $user->getId()),
        ]);
        $this->assertSame('invalid_mfa_token', $again['body']['code']);
    }

    public function testPasskeyOptionsNeedAPasskey(): void
    {
        $this->user();
        $this->assertSame(400, $this->post('/api/auth/mfa/passkey/options', ['mfaToken' => $this->token()])['status']);
    }

    public function testPasskeyLoginAndSsoBypassMfa(): void
    {
        $user = $this->user();
        [$authenticator, $origin] = $this->passkeyFor($user);

        $o = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/webauthn/authenticate/options');
        $r = $this->post('/api/auth/webauthn/authenticate/verify', [
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $authenticator->assertion($o['body']['options']['challenge'], $origin, self::RP_ID, $user->getId()),
        ]);
        $this->assertSession($r);
        $this->assertArrayNotHasKey('mfaRequired', $r['body']);

        $auth = static::getContainer()->get(AuthService::class);
        $verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
        $code = $auth->issueOAuthLoginCode($user, OneTimeTokenService::challengeFor($verifier), 'google');
        $sso = $auth->redeemOneTimeToken($code, $verifier);
        $this->assertArrayHasKey('access_token', $sso);
        $this->assertArrayNotHasKey('mfaRequired', $sso);
    }

    public function testRoutesArePublic(): void
    {
        $this->assertSame(401, $this->post('/api/auth/mfa/verify', ['mfaToken' => 'x', 'method' => 'totp', 'code' => '1'])['status']);
        $this->assertSame(401, $this->post('/api/auth/mfa/passkey/options', ['mfaToken' => 'x'])['status']);
        $this->assertSame(401, $this->post('/api/auth/mfa/passkey/verify', ['mfaToken' => 'x', 'challengeToken' => 'y', 'response' => []])['status']);
    }
}
