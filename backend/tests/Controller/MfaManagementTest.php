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

/** Management API of the second factor: setup, enable, disable, backup codes, passkey rename/delete. */
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
        return 'Bearer '.$this->tokens->createAccessToken($user);
    }

    private function call(string $method, string $uri, array $body, User|string $auth): array
    {
        return TestHelper::jsonRequest($this->client, $method, $uri, $body, $auth instanceof User ? $this->auth($auth) : $auth);
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
            'password' => 'password123',
        ], $user);

        return [$body, $r];
    }

    private function enforcedWithPasskey(User $user): void
    {
        $this->passkey($user);
        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'passkeys'], $user)['body'];
        $r = $this->call('POST', '/api/auth/mfa/enable', [
            'setupToken' => $setup['setupToken'], 'method' => 'passkeys', 'backupCodes' => $setup['backupCodes'],
            'backupCodesAcknowledged' => true, 'password' => 'password123',
        ], $user);
        $this->assertSame(200, $r['status'], $r['content']);
    }

    public function testRoutesNeedAJwt(): void
    {
        foreach ([['POST', '/api/auth/mfa/setup'], ['POST', '/api/auth/mfa/enable'], ['POST', '/api/auth/mfa/disable'], ['POST', '/api/auth/mfa/backup-codes'], ['POST', '/api/auth/mfa/code'], ['PATCH', '/api/auth/webauthn/x'], ['DELETE', '/api/auth/webauthn/x']] as [$m, $u]) {
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

    public function testEnableNeedsProof(): void
    {
        $user = $this->user();
        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user)['body'];
        $base = ['setupToken' => $setup['setupToken'], 'method' => 'totp', 'secret' => $setup['secret'], 'code' => Totp::code($setup['secret'], Totp::step(time())), 'backupCodes' => $setup['backupCodes'], 'backupCodesAcknowledged' => true];

        foreach ([[], ['password' => 'wrong-password'], ['password' => '']] as $proof) {
            $r = $this->call('POST', '/api/auth/mfa/enable', $base + $proof, $user);
            $this->assertSame(400, $r['status']);
            $this->assertSame('invalid_credentials', $r['body']['code']);
            $this->assertSame('password', $r['body']['field']);
        }
        $this->assertFalse($this->em->getRepository(User::class)->findOneBy([])->isMfaEnforced());
    }

    public function testEnableSetupTokenBindsSecretAndCodes(): void
    {
        $user = $this->user();
        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user)['body'];
        $own = Totp::generateSecret();
        $base = ['setupToken' => $setup['setupToken'], 'method' => 'totp', 'backupCodesAcknowledged' => true, 'password' => 'password123'];

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
        $r = $this->call('POST', '/api/auth/mfa/enable', ['password' => 'password123', 'setupToken' => 5, 'method' => 'totp'], $user);
        $this->assertSame('invalid_request', $r['body']['code']);
        $r = $this->call('POST', '/api/auth/mfa/enable', ['password' => ['x']], $user);
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
            'code' => Totp::code($setup['body']['secret'], Totp::step(time())), 'password' => 'password123',
        ], $user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertNotNull($r['body']['mfa']['totp']);
        $this->assertSame($before, $this->conn()->fetchAllAssociative('SELECT id FROM mfa_backup_code ORDER BY id'));
    }

    public function testDisableErrorsAndEffects(): void
    {
        $user = $this->user();
        $r = $this->call('POST', '/api/auth/mfa/disable', ['password' => 'password123'], $user);
        $this->assertSame(409, $r['status']);
        $this->assertSame('mfa_not_enabled', $r['body']['code']);

        $this->passkey($user);
        $this->enableTotp($user);
        $other = $this->tokens->tokenResponse($user);
        $r = $this->call('POST', '/api/auth/mfa/disable', ['password' => 'wrong-password'], $user);
        $this->assertSame('invalid_credentials', $r['body']['code']);
        $this->assertSame(200, $this->call('GET', '/api/auth/me', [], 'Bearer '.$other['access_token'])['status']);

        $r = $this->call('POST', '/api/auth/mfa/disable', ['password' => 'password123'], $user);
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

    public function testBackupCodesRegenerate(): void
    {
        $user = $this->user();
        $r = $this->call('POST', '/api/auth/mfa/backup-codes', ['password' => 'password123'], $user);
        $this->assertSame(409, $r['status']);
        $this->assertSame('mfa_not_enabled', $r['body']['code']);

        [$setup] = $this->enableTotp($user);
        $other = $this->tokens->tokenResponse($user);
        $this->assertSame('invalid_credentials', $this->call('POST', '/api/auth/mfa/backup-codes', ['x' => 1], $user)['body']['code']);

        $r = $this->call('POST', '/api/auth/mfa/backup-codes', ['password' => 'password123'], $user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertCount(10, $r['body']['backupCodes']);
        $this->assertSame(10, $r['body']['mfa']['backupCodes']['remaining']);
        $this->assertNotSame($setup['backupCodes'], $r['body']['backupCodes']);
        $generator = static::getContainer()->get(BackupCodeGenerator::class);
        $hashes = array_column($this->conn()->fetchAllAssociative('SELECT code_hash FROM mfa_backup_code'), 'code_hash');
        $this->assertContains($generator->hash($r['body']['backupCodes'][0]), $hashes);
        $this->assertNotContains($generator->hash($setup['backupCodes'][0]), $hashes);
        $this->assertSame(200, $this->call('GET', '/api/auth/me', [], 'Bearer '.$other['access_token'])['status']);
    }

    public function testMailedCodeAccountsUseConfirmationCode(): void
    {
        $user = $this->passwordless();

        $r = $this->call('POST', '/api/auth/mfa/code', [], $user);
        $this->assertSame(204, $r['status']);
        $code = $this->mailedCode();

        $setup = $this->call('POST', '/api/auth/mfa/setup', ['method' => 'totp'], $user)['body'];
        $body = ['setupToken' => $setup['setupToken'], 'method' => 'totp', 'secret' => $setup['secret'], 'code' => Totp::code($setup['secret'], Totp::step(time())), 'backupCodes' => $setup['backupCodes'], 'backupCodesAcknowledged' => true];
        foreach ([[], ['confirmationCode' => '000000'], ['password' => 'password123']] as $proof) {
            $r = $this->call('POST', '/api/auth/mfa/enable', $body + $proof, $user);
            $this->assertSame(400, $r['status']);
            $this->assertSame('invalid_confirmation_code', $r['body']['code']);
        }
        $r = $this->call('POST', '/api/auth/mfa/enable', $body + ['confirmationCode' => $code], $user);
        $this->assertSame(200, $r['status'], $r['content']);

        // a deletion/passkey code must not work for MFA
        $this->assertSame(204, $this->call('POST', '/api/auth/webauthn/register/code', [], $user)['status']);
    }

    public function testConfirmationCodeErrorShape(): void
    {
        $user = $this->passwordless();
        $r = $this->call('POST', '/api/auth/mfa/disable', ['confirmationCode' => '123456'], $user);
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_confirmation_code', $r['body']['code']);
        $this->assertSame('code', $r['body']['field']);
    }

    public function testPasskeyRegistrationCodeDoesNotWorkForMfa(): void
    {
        $user = $this->passwordless();
        $this->call('POST', '/api/auth/webauthn/register/code', [], $user);
        $code = $this->mailedCode();
        $r = $this->call('POST', '/api/auth/mfa/disable', ['confirmationCode' => $code], $user);
        $this->assertSame('invalid_confirmation_code', $r['body']['code']);
    }

    public function testCodeRouteIsConflictForPasswordAccounts(): void
    {
        $r = $this->call('POST', '/api/auth/mfa/code', [], $this->user());
        $this->assertSame(409, $r['status']);
        $this->assertSame('has_password', $r['body']['code']);
        $this->assertEmailCount(0);
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

    public function testDeletePasskeyNeedsProof(): void
    {
        $user = $this->user();
        $this->passkey($user);

        foreach ([[], ['password' => 'wrong-password']] as $body) {
            $r = $this->call('DELETE', '/api/auth/webauthn/pk-1', $body, $user);
            $this->assertSame(400, $r['status']);
            $this->assertSame('invalid_credentials', $r['body']['code']);
        }
        $this->assertSame(1, $this->em->getRepository(Passkey::class)->count([]));

        $r = $this->call('DELETE', '/api/auth/webauthn/pk-1', ['password' => 'password123'], $user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertTrue($r['body']['ok']);
        $this->assertArrayHasKey('access_token', $r['body']);
        $this->assertSame(0, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM passkey'));
    }

    public function testDeletePasskeyWithMailedCode(): void
    {
        $user = $this->passwordless();
        $this->passkey($user);
        $this->call('POST', '/api/auth/mfa/code', [], $user);
        $code = $this->mailedCode();

        $this->assertSame('invalid_confirmation_code', $this->call('DELETE', '/api/auth/webauthn/pk-1', ['confirmationCode' => '000000'], $user)['body']['code']);
        $this->assertSame(200, $this->call('DELETE', '/api/auth/webauthn/pk-1', ['confirmationCode' => $code], $user)['status']);
    }

    public function testLastPasskeyGuardOnlyAfterValidProof(): void
    {
        $user = $this->user();
        $this->enforcedWithPasskey($user);

        $r = $this->call('DELETE', '/api/auth/webauthn/pk-1', ['password' => 'wrong-password'], $user);
        $this->assertSame('invalid_credentials', $r['body']['code']);

        $r = $this->call('DELETE', '/api/auth/webauthn/pk-1', ['password' => 'password123'], $user);
        $this->assertSame(422, $r['status']);
        $this->assertSame('mfa_last_passkey', $r['body']['code']);
        $this->assertSame(1, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM passkey'));

        // an unknown id stays a 404, not a guard error
        $this->assertSame('passkey_not_found', $this->call('DELETE', '/api/auth/webauthn/nope', ['password' => 'password123'], $user)['body']['code']);

        // a second passkey or a TOTP lifts the guard
        $this->passkey($user, 'pk-2');
        $this->assertSame(200, $this->call('DELETE', '/api/auth/webauthn/pk-1', ['password' => 'password123'], $user)['status']);
    }

    public function testLastPasskeyGuardLiftedByTotp(): void
    {
        $user = $this->user();
        $this->passkey($user);
        $this->enableTotp($user);

        $r = $this->call('DELETE', '/api/auth/webauthn/pk-1', ['password' => 'password123'], $user);
        $this->assertSame(200, $r['status'], $r['content']);
    }

    public function testRestrictedSessionIsGated(): void
    {
        $user = $this->user(false);
        $this->passkey($user);
        $routes = [['POST', '/api/auth/mfa/setup'], ['POST', '/api/auth/mfa/enable'], ['POST', '/api/auth/mfa/disable'], ['POST', '/api/auth/mfa/backup-codes'], ['POST', '/api/auth/mfa/code'], ['PATCH', '/api/auth/webauthn/pk-1'], ['DELETE', '/api/auth/webauthn/pk-1']];
        foreach ($routes as [$m, $u]) {
            $r = $this->call($m, $u, ['method' => 'totp', 'password' => 'password123', 'deviceName' => 'x'], $user);
            $this->assertSame(403, $r['status'], "$m $u");
            $this->assertSame('email_verification_required', $r['body']['code'], "$m $u");
        }
    }

    public function testRateLimitedMailedCode(): void
    {
        $user = $this->passwordless();
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(204, $this->call('POST', '/api/auth/mfa/code', [], $user)['status']);
        }
        $r = $this->call('POST', '/api/auth/mfa/code', [], $user);
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
    }
}
