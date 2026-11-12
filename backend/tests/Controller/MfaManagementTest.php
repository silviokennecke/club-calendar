<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\OAuthAccount;
use App\Entity\Passkey;
use App\Entity\User;
use App\Security\Mfa\BackupCodeGenerator;
use App\Security\Mfa\Totp;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Management API of MFA: setup, enable, disable, backup codes, passkey rename/delete. */
class MfaManagementTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private TokenService $tokens;

    protected function setUp(): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        $this->tokens = static::getContainer()->get(TokenService::class);
        DatabaseResetter::reset($this->em);
    }

    private function user(bool $verified = true): User
    {
        return TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'alice@example.com', 'password123', $verified);
    }

    private function passwordless(): User
    {
        $user = $this->user();
        $user->setPassword(null);
        $account = new OAuthAccount();
        $account->setUser($user)->setProvider('google')->setProviderId('g-1')->setEmail($user->getEmail());
        $this->em->persist($account);
        $this->em->flush();

        return $user;
    }

    private function passkey(User $user, string $id = 'pk-1'): Passkey
    {
        $passkey = (new Passkey())->setId($id)->setUser($this->em->find(User::class, $user->getId()))->setCredentialId('cred-'.$id)->setPublicKey('key')->setCounter(0);
        $this->em->persist($passkey);
        $this->em->flush();

        return $passkey;
    }

    private function auth(User $user): string
    {
        return TestHelper::sessionHeader($user, $this->tokens);
    }

    private function sensitive(string $method, string $uri): bool
    {
        return ('POST' === $method && in_array($uri, ['/api/auth/mfa/setup', '/api/auth/mfa/enable', '/api/auth/mfa/disable', '/api/auth/mfa/backup-codes'], true))
            || ('DELETE' === $method && str_starts_with($uri, '/api/auth/webauthn/'));
    }

    /**
     * A request as `$auth`; a User gets a fresh session and, on the sensitive routes, a valid step-up token
     * (password, or the mailed code for accounts without one; MFA is skipped for fixtures) unless `$stepUp` is false.
     */
    private function call(string $method, string $uri, array $body, User|string $auth, bool $stepUp = true): array
    {
        $token = null;
        if ($auth instanceof User) {
            $user = $auth;
            $auth = $this->auth($user);
            if ($stepUp && $this->sensitive($method, $uri)) {
                $token = $this->obtainStepUp($user, $auth);
            }
        }

        return TestHelper::jsonRequest($this->client, $method, $uri, $body, $auth, $token);
    }

    private function obtainStepUp(User $user, string $auth): string
    {
        $enforced = (bool) $this->conn()->fetchOne('SELECT mfa_enforced FROM user WHERE id = ?', [$user->getId()]);
        $this->conn()->executeStatement('UPDATE user SET mfa_enforced = 0 WHERE id = ?', [$user->getId()]);
        try {
            if (null === $this->conn()->fetchOne('SELECT password FROM user WHERE id = ?', [$user->getId()])) {
                $this->assertSame(204, TestHelper::jsonRequest($this->client, 'POST', '/api/auth/step-up/code', [], $auth)['status']);
                $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/step-up', ['confirmationCode' => $this->mailedCode()], $auth);
                $this->assertSame(200, $r['status'], $r['content']);

                return $enforced ? TestHelper::claimFactor($this->client, $r['body']['stepUpToken']) : $r['body']['stepUpToken'];
            }
            $token = TestHelper::stepUp($this->client, $auth);

            return $enforced ? TestHelper::claimFactor($this->client, $token) : $token;
        } finally {
            $this->conn()->executeStatement('UPDATE user SET mfa_enforced = ? WHERE id = ?', [(int) $enforced, $user->getId()]);
        }
    }

    private function conn(): Connection
    {
        return static::getContainer()->get(Connection::class);
    }

    private function mailedCode(): string
    {
        $mail = $this->getMailerMessage(0);
        $this->assertInstanceOf(Email::class, $mail);
        $this->assertSame(1, preg_match('/letter-spacing:\d+px[^>]*>(\d{3})-(\d{3})</', (string) $mail->getHtmlBody(), $m));

        return $m[1].$m[2];
    }

    /** Runs setup + enable for TOTP with the password. @return array{0: array, 1: array} setup and enable response */
    private function enableTotp(User $user, array $overrides = []): array
    {
        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user);
        $this->assertSame(200, $setup['status'], $setup['content']);
        $body = $setup['body'];
        $r = $this->call('POST', '/api/auth/mfa/enable', $overrides + [
            'setupToken' => $body['setupToken'],
            'method' => 'totp',
            'secret' => $body['secret'],
            'code' => Totp::code($body['secret'], Totp::step(time())),
            'backupCodes' => $body['backupCodes'],
            'backupCodesAcknowledged' => true,
        ], $user);

        return [$body, $r];
    }

    private function enforcedWithPasskey(User $user): void
    {
        $this->passkey($user);
        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'passkeys'], $user)['body'];
        $r = $this->call('POST', '/api/auth/mfa/enable', [
            'setupToken' => $setup['setupToken'], 'method' => 'passkeys', 'backupCodes' => $setup['backupCodes'],
            'backupCodesAcknowledged' => true,
        ], $user);
        $this->assertSame(200, $r['status'], $r['content']);
    }

    public function testRoutesNeedAJwt(): void
    {
        foreach ([['POST', '/api/auth/mfa/setup'], ['POST', '/api/auth/mfa/enable'], ['POST', '/api/auth/mfa/disable'], ['POST', '/api/auth/mfa/backup-codes'], ['PATCH', '/api/auth/webauthn/x'], ['DELETE', '/api/auth/webauthn/x']] as [$m, $u]) {
            $this->assertSame(401, $this->call($m, $u, [], '')['status'], "$m $u");
        }
    }

    public function testSetupTotpReturnsSecretCodesAndStoresNothing(): void
    {
        $user = $this->user();
        $r = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user);

        $this->assertSame(200, $r['status']);
        $this->assertCount(10, $r['body']['backupCodes']);
        $this->assertStringStartsWith('otpauth://totp/', $r['body']['otpauthUri']);
        $this->assertNotEmpty($r['body']['secret']);
        $this->assertSame(0, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM user_totp'));
        $this->assertSame(0, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM mfa_backup_code'));
    }

    public function testSetupNeedsAStepUp(): void
    {
        $r = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $this->user(), false);
        $this->assertSame(403, $r['status']);
        $this->assertSame('step_up_required', $r['body']['code']);
    }

    public function testSetupErrors(): void
    {
        $user = $this->user();
        $this->assertSame('invalid_request', $this->call('POST', '/api/auth/mfa/setup', ['method' => 'sms'], $user)['body']['code']);
        $this->assertSame('invalid_request', $this->call('POST', '/api/auth/mfa/setup', [], $user)['body']['code']);
        $r = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'passkeys'], $user);
        $this->assertSame(422, $r['status']);
        $this->assertSame('mfa_passkey_required', $r['body']['code']);

        $this->enableTotp($user);
        $r = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user);
        $this->assertSame(409, $r['status']);
        $this->assertSame('totp_already_set', $r['body']['code']);
        $r = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'passkeys'], $user);
        $this->assertSame(409, $r['status']);
        $this->assertSame('mfa_already_enabled', $r['body']['code']);
    }

    public function testEnableTotpStoresEverythingAndKeepsOtherSessions(): void
    {
        $user = $this->user();
        $other = $this->tokens->tokenResponse($user);
        [, $r] = $this->enableTotp($user);
        $this->assertCount(1, array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email));

        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertTrue($r['body']['mfa']['enforced']);
        $this->assertNotNull($r['body']['mfa']['totp']);
        $this->assertSame(10, $r['body']['mfa']['backupCodes']['remaining']);
        $this->assertSame(200, $this->call('GET', '/api/auth/me', [], 'Bearer '.$other['access_token'])['status']);
        $me = $this->call('GET', '/api/auth/me', [], $user);
        $this->assertSame($r['body']['mfa'], $me['body']['mfa']);
        $this->assertCount(1, $this->conn()->fetchAllAssociative("SELECT id FROM security_event WHERE type = 'mfa_enabled'"));
    }

    public function testMeHasMfaBlockForPlainAccount(): void
    {
        $me = $this->call('GET', '/api/auth/me', [], $this->user());
        $this->assertSame(['enforced' => false, 'totp' => null, 'backupCodes' => null, 'canEnforce' => false], $me['body']['mfa']);
    }

    public function testEnableNeedsAStepUp(): void
    {
        $user = $this->user();
        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user)['body'];
        $base = ['setupToken' => $setup['setupToken'], 'method' => 'totp', 'secret' => $setup['secret'], 'code' => Totp::code($setup['secret'], Totp::step(time())), 'backupCodes' => $setup['backupCodes'], 'backupCodesAcknowledged' => true];

        foreach ([[], ['password' => 'password123'], ['password' => '']] as $legacy) {
            $r = $this->call('POST', '/api/auth/mfa/enable', $base + $legacy, $user, false);
            $this->assertSame(403, $r['status']);
            $this->assertSame('step_up_required', $r['body']['code']);
        }
        $this->assertFalse($this->em->getRepository(User::class)->findOneBy([])->isMfaEnforced());
    }

    public function testEnableSetupTokenBindsSecretAndCodes(): void
    {
        $user = $this->user();
        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user)['body'];
        $own = Totp::generateSecret();
        $base = ['setupToken' => $setup['setupToken'], 'method' => 'totp', 'backupCodesAcknowledged' => true];

        $r = $this->call('POST', '/api/auth/mfa/enable', $base + ['secret' => $own, 'code' => Totp::code($own, Totp::step(time())), 'backupCodes' => $setup['backupCodes']], $user);
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_mfa_setup', $r['body']['code']);

        $own2 = $setup['backupCodes'];
        $own2[0] = 'AAAA-BBBB-CCCC';
        $r = $this->call('POST', '/api/auth/mfa/enable', $base + ['secret' => $setup['secret'], 'code' => Totp::code($setup['secret'], Totp::step(time())), 'backupCodes' => $own2], $user);
        $this->assertSame('invalid_mfa_setup', $r['body']['code']);

        $r = $this->call('POST', '/api/auth/mfa/enable', ['setupToken' => 'garbage'] + $base + ['secret' => $setup['secret']], $user);
        $this->assertSame('invalid_mfa_setup', $r['body']['code']);

        // another user cannot use the token
        $mallory = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'mallory@example.com');
        $r = $this->call('POST', '/api/auth/mfa/enable', $base + ['secret' => $setup['secret'], 'code' => Totp::code($setup['secret'], Totp::step(time())), 'backupCodes' => $setup['backupCodes']], $mallory);
        $this->assertSame('invalid_mfa_setup', $r['body']['code']);
    }

    public function testEnableRequiresAcknowledgementAndRightCodeAndSetupIsSingleUse(): void
    {
        $user = $this->user();
        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user)['body'];
        $base = ['setupToken' => $setup['setupToken'], 'method' => 'totp', 'secret' => $setup['secret'], 'backupCodes' => $setup['backupCodes'], 'password' => 'password123'];
        $good = Totp::code($setup['secret'], Totp::step(time()));

        $r = $this->call('POST', '/api/auth/mfa/enable', $base + ['code' => $good, 'backupCodesAcknowledged' => false], $user);
        $this->assertSame(422, $r['status']);
        $this->assertSame('backup_codes_not_acknowledged', $r['body']['code']);
        $r = $this->call('POST', '/api/auth/mfa/enable', $base + ['code' => $good], $user);
        $this->assertSame('backup_codes_not_acknowledged', $r['body']['code']);

        $r = $this->call('POST', '/api/auth/mfa/enable', $base + ['code' => '000000', 'backupCodesAcknowledged' => true], $user);
        $this->assertSame(422, $r['status']);
        $this->assertSame('invalid_totp_code', $r['body']['code']);
        $this->assertSame('code', $r['body']['field']);

        $this->assertSame(200, $this->call('POST', '/api/auth/mfa/enable', $base + ['code' => $good, 'backupCodesAcknowledged' => true], $user)['status']);
        // replay of the same token: already set up
        $r = $this->call('POST', '/api/auth/mfa/enable', $base + ['code' => $good, 'backupCodesAcknowledged' => true], $user);
        $this->assertSame(409, $r['status']);
    }

    public function testEnableRejectsMalformedBody(): void
    {
        $user = $this->user();
        $r = $this->call('POST', '/api/auth/mfa/enable', ['setupToken' => 5, 'method' => 'totp'], $user);
        $this->assertSame('invalid_request', $r['body']['code']);
        $r = $this->call('POST', '/api/auth/mfa/enable', ['code' => ['x']], $user);
        $this->assertSame('invalid_request', $r['body']['code']);
    }

    public function testPasskeyEnforcementAndTotpAddedWhileEnforcedKeepsCodes(): void
    {
        $user = $this->user();
        $this->enforcedWithPasskey($user);
        $before = $this->conn()->fetchAllAssociative('SELECT id FROM mfa_backup_code ORDER BY id');
        $this->assertCount(10, $before);

        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user);
        $this->assertSame(200, $setup['status']);
        $this->assertNull($setup['body']['backupCodes']);

        $r = $this->call('POST', '/api/auth/mfa/enable', [
            'setupToken' => $setup['body']['setupToken'], 'method' => 'totp', 'secret' => $setup['body']['secret'],
            'code' => Totp::code($setup['body']['secret'], Totp::step(time())),
        ], $user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertNotNull($r['body']['mfa']['totp']);
        $this->assertSame($before, $this->conn()->fetchAllAssociative('SELECT id FROM mfa_backup_code ORDER BY id'));
    }

    public function testDisableErrorsAndEffects(): void
    {
        $user = $this->user();
        $r = $this->call('POST', '/api/auth/mfa/disable', [], $user);
        $this->assertSame(409, $r['status']);
        $this->assertSame('mfa_not_enabled', $r['body']['code']);

        $this->passkey($user);
        $this->enableTotp($user);
        $other = $this->tokens->tokenResponse($user);
        $r = $this->call('POST', '/api/auth/mfa/disable', [], $user, false);
        $this->assertSame('step_up_required', $r['body']['code']);
        $this->assertSame(200, $this->call('GET', '/api/auth/me', [], 'Bearer '.$other['access_token'])['status']);

        $r = $this->call('POST', '/api/auth/mfa/disable', [], $user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertFalse($r['body']['mfa']['enforced']);
        $this->assertNull($r['body']['mfa']['totp']);
        $this->assertNull($r['body']['mfa']['backupCodes']);
        $this->assertSame('Bearer', $r['body']['token_type']);
        $this->assertSame(401, $this->call('GET', '/api/auth/me', [], 'Bearer '.$other['access_token'])['status']);
        $me = $this->call('GET', '/api/auth/me', [], 'Bearer '.$r['body']['access_token']);
        $this->assertSame(200, $me['status']);
        $this->assertCount(1, $me['body']['passkeys']);
        $this->client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $r['body']['refresh_token']]);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());
        $this->assertCount(1, $this->conn()->fetchAllAssociative("SELECT id FROM security_event WHERE type = 'mfa_disabled'"));
    }

    public function testSignOutOthersEndsOtherSessionsAndKeepsThisOne(): void
    {
        $user = $this->user();
        $this->enableTotp($user);
        $other = $this->tokens->tokenResponse($user);
        $this->assertSame(401, $this->call('POST', '/api/auth/sessions/sign-out-others', [], '')['status']);

        $r = $this->call('POST', '/api/auth/sessions/sign-out-others', [], $user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertTrue($r['body']['ok']);
        $this->assertSame(401, $this->call('GET', '/api/auth/me', [], 'Bearer '.$other['access_token'])['status']);
        $this->assertSame(200, $this->call('GET', '/api/auth/me', [], 'Bearer '.$r['body']['access_token'])['status']);
        $this->client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $r['body']['refresh_token']]);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());
        $this->assertCount(1, $this->conn()->fetchAllAssociative("SELECT id FROM security_event WHERE type = 'sessions_ended'"));
        $this->em->clear();
        $this->assertTrue($this->em->find(User::class, $user->getId())->isMfaEnforced());
    }

    public function testSignOutOthersNeverExtendsTheAbsoluteSessionLifetime(): void
    {
        $user = $this->user();
        $this->enableTotp($user);
        $session = $this->tokens->tokenResponse($user);
        $aged = (new \DateTimeImmutable('+1 day', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s');
        $this->conn()->executeStatement('UPDATE refresh_token SET family_expires_at = ?', [$aged]);

        $access = $session['access_token'];
        $oldFamily = $this->tokens->decodeRefreshToken($session['refresh_token'])['fam'];
        for ($i = 0; $i < 3; ++$i) {
            $r = $this->call('POST', '/api/auth/sessions/sign-out-others', [], 'Bearer '.$access);
            $this->assertSame(200, $r['status'], $r['content']);
            $access = $r['body']['access_token'];
            $family = $this->tokens->decodeRefreshToken($r['body']['refresh_token'])['fam'];
            $this->assertNotSame($oldFamily, $family);
            $this->assertSame($aged, $this->conn()->fetchOne('SELECT family_expires_at FROM refresh_token WHERE family_id = ?', [$family]));
            $this->assertNotNull($this->conn()->fetchOne('SELECT MIN(revoked_at) FROM refresh_token WHERE family_id = ?', [$oldFamily]));
            $oldFamily = $family;
        }
        $this->assertSame([], $this->conn()->fetchFirstColumn('SELECT id FROM refresh_token WHERE family_expires_at > ?', [$aged]));
    }

    public function testBackupCodesRegenerate(): void
    {
        $user = $this->user();
        $r = $this->call('POST', '/api/auth/mfa/backup-codes', [], $user);
        $this->assertSame(409, $r['status']);
        $this->assertSame('mfa_not_enabled', $r['body']['code']);

        [$setup] = $this->enableTotp($user);
        $other = $this->tokens->tokenResponse($user);
        $this->assertSame('step_up_required', $this->call('POST', '/api/auth/mfa/backup-codes', [], $user, false)['body']['code']);

        $r = $this->call('POST', '/api/auth/mfa/backup-codes', [], $user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertCount(10, $r['body']['backupCodes']);
        $this->assertSame(10, $r['body']['mfa']['backupCodes']['remaining']);
        $this->assertNotSame($setup['backupCodes'], $r['body']['backupCodes']);
        $generator = static::getContainer()->get(BackupCodeGenerator::class);
        $hasher = static::getContainer()->get('security.password_hasher_factory')->getPasswordHasher('backup_code');
        $hashes = array_column($this->conn()->fetchAllAssociative('SELECT code_hash FROM mfa_backup_code'), 'code_hash');
        $this->assertCount(10, $hashes);
        $this->assertStringStartsWith('$2y$', $hashes[0]);
        $matches = static fn (string $code): bool => [] !== array_filter($hashes, static fn (string $h): bool => $hasher->verify($h, $generator->normalize($code)));
        $this->assertTrue($matches($r['body']['backupCodes'][0]));
        $this->assertFalse($matches($setup['backupCodes'][0]));
        $this->assertSame(200, $this->call('GET', '/api/auth/me', [], 'Bearer '.$other['access_token'])['status']);
    }

    public function testAccountsWithoutPasswordConfirmWithTheMailedStepUpCode(): void
    {
        $user = $this->passwordless();

        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user)['body'];
        $body = ['setupToken' => $setup['setupToken'], 'method' => 'totp', 'secret' => $setup['secret'], 'code' => Totp::code($setup['secret'], Totp::step(time())), 'backupCodes' => $setup['backupCodes'], 'backupCodesAcknowledged' => true];
        foreach ([[], ['confirmationCode' => '000000']] as $legacy) {
            $r = $this->call('POST', '/api/auth/mfa/enable', $body + $legacy, $user, false);
            $this->assertSame('step_up_required', $r['body']['code']);
        }
        $r = $this->call('POST', '/api/auth/mfa/enable', $body, $user);
        $this->assertSame(200, $r['status'], $r['content']);
    }

    public function testObsoleteCodeRoutesAreGone(): void
    {
        $user = $this->passwordless();
        foreach (['/api/auth/mfa/code', '/api/auth/webauthn/register/code', '/api/auth/delete-account/code'] as $uri) {
            $this->assertSame(404, $this->call('POST', $uri, [], $user)['status'], $uri);
        }
    }

    public function testRenameNeedsNoReauth(): void
    {
        $user = $this->user();
        $this->passkey($user);

        $r = $this->call('PATCH', '/api/auth/webauthn/pk-1', ['deviceName' => ' Work laptop '], $user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame('Work laptop', $this->call('GET', '/api/auth/me', [], $user)['body']['passkeys'][0]['deviceName']);

        $this->assertSame(404, $this->call('PATCH', '/api/auth/webauthn/nope', ['deviceName' => 'x'], $user)['status']);
        $this->assertSame('passkey_not_found', $this->call('PATCH', '/api/auth/webauthn/nope', ['deviceName' => 'x'], $user)['body']['code']);
        foreach ([[], ['deviceName' => ''], ['deviceName' => str_repeat('a', 256)], ['deviceName' => 5]] as $body) {
            $this->assertSame('invalid_request', $this->call('PATCH', '/api/auth/webauthn/pk-1', $body, $user)['body']['code']);
        }
        $this->assertSame(200, $this->call('PATCH', '/api/auth/webauthn/pk-1', ['deviceName' => str_repeat('a', 255)], $user)['status']);

        $other = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'bob@example.com');
        $this->assertSame(404, $this->call('PATCH', '/api/auth/webauthn/pk-1', ['deviceName' => 'mine'], $other)['status']);
    }

    public function testDeletePasskeyNeedsAStepUp(): void
    {
        $user = $this->user();
        $this->passkey($user);

        foreach ([[], ['password' => 'password123']] as $body) {
            $r = $this->call('DELETE', '/api/auth/webauthn/pk-1', $body, $user, false);
            $this->assertSame(403, $r['status']);
            $this->assertSame('step_up_required', $r['body']['code']);
        }
        $this->assertSame(1, $this->em->getRepository(Passkey::class)->count([]));

        $r = $this->call('DELETE', '/api/auth/webauthn/pk-1', [], $user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertTrue($r['body']['ok']);
        $this->assertArrayHasKey('access_token', $r['body']);
        $this->assertSame(0, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM passkey'));
    }

    public function testDeletePasskeyWithMailedStepUpCode(): void
    {
        $user = $this->passwordless();
        $this->passkey($user);

        $this->assertSame('step_up_required', $this->call('DELETE', '/api/auth/webauthn/pk-1', [], $user, false)['body']['code']);
        $this->assertSame(200, $this->call('DELETE', '/api/auth/webauthn/pk-1', [], $user)['status']);
    }

    public function testLastPasskeyGuardOnlyAfterAValidStepUp(): void
    {
        $user = $this->user();
        $this->enforcedWithPasskey($user);

        $r = $this->call('DELETE', '/api/auth/webauthn/pk-1', [], $user, false);
        $this->assertSame('step_up_required', $r['body']['code']);

        $r = $this->call('DELETE', '/api/auth/webauthn/pk-1', [], $user);
        $this->assertSame(422, $r['status']);
        $this->assertSame('mfa_last_passkey', $r['body']['code']);
        $this->assertSame(1, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM passkey'));

        // an unknown id stays a 404, not a guard error
        $this->assertSame('passkey_not_found', $this->call('DELETE', '/api/auth/webauthn/nope', [], $user)['body']['code']);

        // a second passkey or a TOTP lifts the guard
        $this->passkey($user, 'pk-2');
        $this->assertSame(200, $this->call('DELETE', '/api/auth/webauthn/pk-1', [], $user)['status']);
    }

    public function testLastPasskeyGuardLiftedByTotp(): void
    {
        $user = $this->user();
        $this->passkey($user);
        $this->enableTotp($user);

        $r = $this->call('DELETE', '/api/auth/webauthn/pk-1', [], $user);
        $this->assertSame(200, $r['status'], $r['content']);
    }

    public function testRestrictedSessionIsGated(): void
    {
        $user = $this->user(false);
        $this->passkey($user);
        $routes = [['POST', '/api/auth/mfa/setup'], ['POST', '/api/auth/mfa/enable'], ['POST', '/api/auth/mfa/disable'], ['POST', '/api/auth/mfa/backup-codes'], ['PATCH', '/api/auth/webauthn/pk-1'], ['DELETE', '/api/auth/webauthn/pk-1']];
        foreach ($routes as [$m, $u]) {
            $r = $this->call($m, $u, ['method' => 'totp', 'password' => 'password123', 'deviceName' => 'x'], $user);
            $this->assertSame(403, $r['status'], "$m $u");
            $this->assertSame('email_verification_required', $r['body']['code'], "$m $u");
        }
    }
}
