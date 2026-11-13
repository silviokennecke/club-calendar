<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\McpGrant;
use App\Entity\OAuthClient;
use App\Entity\Passkey;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Repository\MfaBackupCodeRepository;
use App\Repository\UserTotpRepository;
use App\Security\ClientContext;
use App\Security\Mfa\Totp;
use App\Service\MfaService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class MfaServiceTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private MfaService $mfa;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        $this->mfa = $c->get(MfaService::class);
        DatabaseResetter::reset($this->em);
    }

    private function user(): User
    {
        return TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class));
    }

    private function addPasskey(User $user, string $id = 'pk1'): void
    {
        $pk = new Passkey();
        $pk->setId($id)->setUser($user)->setCredentialId($id)->setPublicKey('k');
        $this->em->persist($pk);
        $this->em->flush();
    }

    /** @return array{0: User, 1: list<string>} an enforced TOTP user with its backup codes */
    private function enabledTotpUser(): array
    {
        $user = $this->user();
        $setup = $this->mfa->setup($user, 'totp');
        $code = Totp::code($setup['secret'], Totp::step(time()));
        $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], $code, $setup['backupCodes'], true);

        return [$user, $setup['backupCodes']];
    }

    private function assertProblem(string $code, callable $fn): void
    {
        try {
            $fn();
            $this->fail("Expected $code");
        } catch (ApiProblemException $e) {
            $this->assertSame($code, $e->getErrorCode());
        }
    }

    public function testSetupAndEnableTotp(): void
    {
        $user = $this->user();
        $setup = $this->mfa->setup($user, 'totp');
        $this->assertCount(10, $setup['backupCodes']);
        $this->assertStringStartsWith('otpauth://totp/', $setup['otpauthUri']);
        $this->assertFalse($user->isMfaEnforced(), 'setup stores nothing');
        $this->assertNull(static::getContainer()->get(UserTotpRepository::class)->findOneByUser($user));

        $version = $user->getTokenVersion();
        $status = $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], Totp::code($setup['secret'], Totp::step(time())), $setup['backupCodes'], true);

        $this->assertTrue($status['enforced']);
        $this->assertNotNull($status['totp']);
        $this->assertSame(['remaining' => 10, 'createdAt' => $status['backupCodes']['createdAt']], $status['backupCodes']);
        $this->assertSame($version, $user->getTokenVersion(), 'enable does not end sessions');
    }

    public function testEnableErrors(): void
    {
        $user = $this->user();
        $setup = $this->mfa->setup($user, 'totp');
        $good = Totp::code($setup['secret'], Totp::step(time()));

        $this->assertProblem('invalid_mfa_setup', fn () => $this->mfa->enable($user, 'garbage', 'totp', $setup['secret'], $good, $setup['backupCodes'], true));
        $this->assertProblem('backup_codes_not_acknowledged', fn () => $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], $good, $setup['backupCodes'], false));
        $this->assertProblem('invalid_totp_code', fn () => $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], '000000' === $good ? '111111' : '000000', $setup['backupCodes'], true));
        $this->assertFalse($user->isMfaEnforced());

        // A used setup cannot be replayed
        $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], $good, $setup['backupCodes'], true);
        $this->assertProblem('totp_already_set', fn () => $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], $good, $setup['backupCodes'], true));
        $this->assertProblem('totp_already_set', fn () => $this->mfa->setup($user, 'totp'));
        $this->assertProblem('mfa_already_enabled', fn () => $this->mfa->setup($user, 'passkeys'));
    }

    public function testSetupTokenIsBoundToSecretCodesUserAndMethod(): void
    {
        $user = $this->user();
        $other = $this->user();
        $setup = $this->mfa->setup($user, 'totp');
        $ownSecret = Totp::generateSecret();
        $ownCode = Totp::code($ownSecret, Totp::step(time()));

        $this->assertProblem('invalid_mfa_setup', fn () => $this->mfa->enable($user, $setup['setupToken'], 'totp', $ownSecret, $ownCode, $setup['backupCodes'], true));
        $codes = $setup['backupCodes'];
        $codes[0] = '0000-0000-0000';
        $good = Totp::code($setup['secret'], Totp::step(time()));
        $this->assertProblem('invalid_mfa_setup', fn () => $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], $good, $codes, true));
        $this->assertProblem('invalid_mfa_setup', fn () => $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], $good, null, true));
        $this->assertProblem('invalid_mfa_setup', fn () => $this->mfa->enable($other, $setup['setupToken'], 'totp', $setup['secret'], $good, $setup['backupCodes'], true));
        $this->assertFalse($user->isMfaEnforced());
    }

    public function testPasskeyEnforcementNeedsPasskeyAndKeepsLaterTotpCodes(): void
    {
        $user = $this->user();
        $this->assertProblem('mfa_passkey_required', fn () => $this->mfa->setup($user, 'passkeys'));

        $this->addPasskey($user);
        $this->assertTrue($this->mfa->status($user)['canEnforce']);
        $setup = $this->mfa->setup($user, 'passkeys');
        $status = $this->mfa->enable($user, $setup['setupToken'], 'passkeys', null, null, $setup['backupCodes'], true);
        $this->assertTrue($status['enforced']);
        $this->assertNull($status['totp']);
        $this->assertFalse($status['canEnforce']);

        // Adding TOTP later keeps the existing codes
        $totpSetup = $this->mfa->setup($user, 'totp');
        $this->assertNull($totpSetup['backupCodes']);
        $status = $this->mfa->enable($user, $totpSetup['setupToken'], 'totp', $totpSetup['secret'], Totp::code($totpSetup['secret'], Totp::step(time())), null, false);
        $this->assertSame(10, $status['backupCodes']['remaining']);
        $this->assertTrue($this->mfa->consumeBackupCode($user, $setup['backupCodes'][0]));
    }

    public function testTotpReplayIsRejected(): void
    {
        [$user] = $this->enabledTotpUser();
        $secret = static::getContainer()->get(UserTotpRepository::class)->findOneByUser($user)->getSecret();
        $now = Totp::step(time());

        // The code used to enable is spent
        $this->assertFalse($this->mfa->verifyTotp($user, Totp::code($secret, $now)));
        $next = Totp::code($secret, $now + 1);
        $this->assertTrue($this->mfa->verifyTotp($user, $next));
        $this->assertFalse($this->mfa->verifyTotp($user, $next));
        $this->assertFalse($this->mfa->verifyTotp($user, Totp::code($secret, $now)), 'older step after a newer one');
        $this->assertFalse($this->mfa->verifyTotp($user, 'abcdef'));
    }

    public function testBackupCodeIsSingleUseAndStaleCopiesLose(): void
    {
        [$user, $codes] = $this->enabledTotpUser();
        $repo = static::getContainer()->get(MfaBackupCodeRepository::class);

        // Two requests that both passed the "unused" read: only the conditional UPDATE of one wins
        $id = $repo->findUnused($user)[0]->getId();
        $this->assertTrue($repo->consume($id));
        $this->assertFalse($repo->consume($id));

        $this->assertTrue($this->mfa->consumeBackupCode($user, strtolower($codes[1])), 'case and dashes are tolerated');
        $this->assertFalse($this->mfa->consumeBackupCode($user, $codes[1]));
        $this->assertFalse($this->mfa->consumeBackupCode($user, 'nonsense'));
        $this->assertSame(8, $this->mfa->status($user)['backupCodes']['remaining']);
    }

    public function testRegenerateReplacesCodes(): void
    {
        [$user, $old] = $this->enabledTotpUser();
        $new = $this->mfa->regenerateBackupCodes($user);
        $this->assertCount(10, $new);
        $this->assertFalse($this->mfa->consumeBackupCode($user, $old[0]));
        $this->assertTrue($this->mfa->consumeBackupCode($user, $new[0]));
        $this->assertProblem('mfa_not_enabled', fn () => $this->mfa->regenerateBackupCodes($this->user()));
    }

    public function testDisableEndsSessionsAndMcpGrantsButKeepsPasskeys(): void
    {
        [$user] = $this->enabledTotpUser();
        $this->addPasskey($user);
        $tokens = static::getContainer()->get(TokenService::class);
        $header = TestHelper::authHeader($user, $tokens);
        $now = new \DateTimeImmutable();
        $oauthClient = new OAuthClient('App', ['https://app.example.org/cb'], $now, 'claude');
        $grant = new McpGrant($user, $oauthClient, 'mcp:read', $now, $now->modify('+30 days'));
        $this->em->persist($oauthClient);
        $this->em->persist($grant);
        $this->em->flush();
        $grantId = $grant->getId();

        $this->client->request('GET', '/api/auth/me', server: ['HTTP_AUTHORIZATION' => $header]);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());

        $this->mfa->disable($user);

        $this->client->request('GET', '/api/auth/me', server: ['HTTP_AUTHORIZATION' => $header]);
        $this->assertSame(401, $this->client->getResponse()->getStatusCode());
        $this->assertNotNull($this->em->getConnection()->fetchOne('SELECT revoked_at FROM mcp_grant WHERE id = ?', [$grantId]));
        $user = $this->em->find(User::class, $user->getId());
        $this->assertFalse($user->isMfaEnforced());
        $status = $this->mfa->status($user);
        $this->assertNull($status['totp']);
        $this->assertNull($status['backupCodes']);
        $this->assertSame(1, $this->em->getRepository(Passkey::class)->count(['user' => $user]));

        $fresh = TestHelper::authHeader($user, $tokens);
        $this->client->request('GET', '/api/auth/me', server: ['HTTP_AUTHORIZATION' => $fresh]);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());
        $this->assertProblem('mfa_not_enabled', fn () => $this->mfa->disable($user));
    }

    public function testEndOtherSessionsBumpsTokenVersionAndKeepsMfa(): void
    {
        [$user] = $this->enabledTotpUser();
        $version = $user->getTokenVersion();
        $this->em->getConnection()->executeStatement('DELETE FROM security_event');
        $this->mfa->endOtherSessions($user, $this->ctx());
        $this->assertSame($version + 1, $user->getTokenVersion());
        $this->assertTrue($user->isMfaEnforced());
        $rows = $this->events();
        $this->assertCount(1, $rows);
        $this->assertSame('sessions_ended', $rows[0]['type']);
        $this->assertSame('user', $rows[0]['method']);
    }

    public function testLastPasskeyGuard(): void
    {
        $user = $this->user();
        $this->addPasskey($user);
        $this->mfa->assertPasskeyDeletable($user);

        $setup = $this->mfa->setup($user, 'passkeys');
        $this->mfa->enable($user, $setup['setupToken'], 'passkeys', null, null, $setup['backupCodes'], true);
        $this->assertProblem('mfa_last_passkey', fn () => $this->mfa->assertPasskeyDeletable($user));

        $this->addPasskey($user, 'pk2');
        $this->mfa->assertPasskeyDeletable($user);
    }

    /** @return list<array<string, mixed>> */
    private function events(): array
    {
        return static::getContainer()->get(Connection::class)->fetchAllAssociative('SELECT * FROM security_event ORDER BY created_at, id');
    }

    private function mailCount(): int
    {
        return count(array_filter(self::getMailerMessages(), fn ($m) => $m instanceof Email));
    }

    private function ctx(): ClientContext
    {
        return new ClientContext('203.0.113.9', 'Firefox on Linux', 'Berlin', 'DE');
    }

    public function testEnableRecordsEventAndMail(): void
    {
        $user = $this->user();
        $setup = $this->mfa->setup($user, 'totp');
        $code = Totp::code($setup['secret'], Totp::step(time()));
        $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], $code, $setup['backupCodes'], true, $this->ctx());

        $rows = $this->events();
        $this->assertCount(1, $rows);
        $this->assertSame('mfa_enabled', $rows[0]['type']);
        $this->assertSame('totp', $rows[0]['method']);
        $this->assertSame('203.0.113.9', $rows[0]['ip']);
        $this->assertSame('Berlin', $rows[0]['city']);
        $this->assertSame(1, $this->mailCount());
    }

    public function testFailedEnableRecordsNothing(): void
    {
        $user = $this->user();
        $setup = $this->mfa->setup($user, 'totp');
        $this->assertProblem('invalid_totp_code', fn () => $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], '000000', $setup['backupCodes'], true, $this->ctx()));
        $this->assertSame([], $this->events());
        $this->assertSame(0, $this->mailCount());
    }

    public function testRegenerateRecordsEventAndMail(): void
    {
        [$user] = $this->enabledTotpUser();
        $this->em->getConnection()->executeStatement('DELETE FROM security_event');
        $before = $this->mailCount();
        $this->mfa->regenerateBackupCodes($user, $this->ctx());

        $rows = $this->events();
        $this->assertCount(1, $rows);
        $this->assertSame('backup_codes_regenerated', $rows[0]['type']);
        $this->assertSame('203.0.113.9', $rows[0]['ip']);
        $this->assertSame($before + 1, $this->mailCount());
    }

    public function testDisableRecordsEventAndMail(): void
    {
        [$user] = $this->enabledTotpUser();
        $this->em->getConnection()->executeStatement('DELETE FROM security_event');
        $before = $this->mailCount();
        $this->mfa->disable($user, $this->ctx());

        $rows = $this->events();
        $this->assertCount(1, $rows);
        $this->assertSame('mfa_disabled', $rows[0]['type']);
        $this->assertSame('password', $rows[0]['method']);
        $this->assertSame($before + 1, $this->mailCount());
    }

    public function testDisableWithoutClientAddressIsCli(): void
    {
        [$user] = $this->enabledTotpUser();
        $this->em->getConnection()->executeStatement('DELETE FROM security_event');
        $this->mfa->disable($user);

        $rows = $this->events();
        $this->assertCount(1, $rows);
        $this->assertSame('cli', $rows[0]['method']);
        $this->assertNull($rows[0]['ip']);
    }

    public function testBackupCodeUsedRecordsEventAndMail(): void
    {
        [$user] = $this->enabledTotpUser();
        $this->em->getConnection()->executeStatement('DELETE FROM security_event');
        $before = $this->mailCount();
        $this->mfa->notifyBackupCodeUsed($user, 7, $this->ctx());

        $rows = $this->events();
        $this->assertCount(1, $rows);
        $this->assertSame('backup_code_used', $rows[0]['type']);
        $this->assertSame($before + 1, $this->mailCount());
        $this->assertTrue($user->isMfaEnforced());
    }

    public function testNoEventWhenOperationThrows(): void
    {
        $user = $this->user();
        $this->assertProblem('mfa_not_enabled', fn () => $this->mfa->disable($user, $this->ctx()));
        $this->assertProblem('mfa_not_enabled', fn () => $this->mfa->regenerateBackupCodes($user, $this->ctx()));
        $this->assertSame([], $this->events());
        $this->assertSame(0, $this->mailCount());
    }
}
