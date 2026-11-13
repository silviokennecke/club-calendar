<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Entity\Passkey;
use App\Entity\User;
use App\Security\ClientContext;
use App\Security\Mfa\Totp;
use App\Service\MfaService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** app:user:disable-mfa */
class UserDisableMfaCommandTest extends WebTestCase
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

    private function enforcedUser(string $email): User
    {
        $user = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), $email);
        $setup = $this->mfa->setup($user, 'totp');
        $code = Totp::code($setup['secret'], Totp::step(time()));
        $this->mfa->enable($user, $setup['setupToken'], 'totp', $setup['secret'], $code, $setup['backupCodes'], true);
        $pk = new Passkey();
        $pk->setId('pk-'.$email)->setUser($user)->setCredentialId('pk-'.$email)->setPublicKey('k');
        $this->em->persist($pk);
        $this->em->flush();
        $this->drainMail();

        return $user;
    }

    private int $seenMails = 0;

    /** @return list<Email> mails sent since the last call */
    private function drainMail(): array
    {
        $all = array_values(array_filter(self::getMailerMessages(), fn ($m) => $m instanceof Email));
        $mails = \array_slice($all, $this->seenMails);
        $this->seenMails = \count($all);
        $this->getMailerMessages() && self::getMailerMessages();

        return $mails;
    }

    private function disableMfa(string $arg): CommandTester
    {
        $t = new CommandTester((new Application($this->client->getKernel()))->find('app:user:disable-mfa'));
        $t->execute(['user' => $arg]);

        return $t;
    }

    /** @return array<string, mixed> */
    private function state(string $id): array
    {
        $c = static::getContainer()->get(Connection::class);

        return [
            'totp' => (int) $c->fetchOne('SELECT COUNT(*) FROM user_totp WHERE user_id = ?', [$id]),
            'codes' => (int) $c->fetchOne('SELECT COUNT(*) FROM mfa_backup_code WHERE user_id = ?', [$id]),
            'passkeys' => (int) $c->fetchOne('SELECT COUNT(*) FROM passkey WHERE user_id = ?', [$id]),
            'enforced' => (int) $c->fetchOne('SELECT mfa_enforced FROM user WHERE id = ?', [$id]),
            'tv' => (int) $c->fetchOne('SELECT token_version FROM user WHERE id = ?', [$id]),
        ];
    }

    public function testDisablesMfaKeepsPasskeyEndsSessionsAndMailsOperatorNotice(): void
    {
        $user = $this->enforcedUser('mfa@example.com');
        $id = $user->getId();
        $tokens = static::getContainer()->get(TokenService::class);
        $old = $tokens->tokenResponse($user)['access_token'] ?? $tokens->tokenResponse($user)['accessToken'];
        $before = $this->state($id);
        $this->assertSame(1, $before['totp']);
        $this->assertGreaterThan(0, $before['codes']);

        $t = $this->disableMfa('mfa@example.com');
        $this->assertSame(Command::SUCCESS, $t->getStatusCode());

        $after = $this->state($id);
        $this->assertSame(0, $after['totp']);
        $this->assertSame(0, $after['codes']);
        $this->assertSame(0, $after['enforced']);
        $this->assertSame(1, $after['passkeys']);
        $this->assertGreaterThan($before['tv'], $after['tv']);

        $this->client->request('GET', '/api/auth/me', [], [], ['HTTP_AUTHORIZATION' => 'Bearer '.$old]);
        $this->assertSame(401, $this->client->getResponse()->getStatusCode());

        $c = static::getContainer()->get(Connection::class);
        $methods = $c->fetchFirstColumn("SELECT method FROM security_event WHERE user_id = ? AND type = 'mfa_disabled'", [$id]);
        $this->assertSame(['cli'], $methods);

        $mails = $this->drainMail();
        $this->assertCount(1, $mails);
        $body = $mails[0]->getHtmlBody();
        $this->assertStringContainsString('by the operator', $body);
        $this->assertSame(3, substr_count($body, 'unknown'), 'IP, location and browser are unknown');
    }

    public function testUnknownUserFails(): void
    {
        $t = $this->disableMfa('nobody@example.com');
        $this->assertSame(Command::FAILURE, $t->getStatusCode());
        $this->assertCount(0, $this->drainMail());
    }

    public function testNotEnabledIsIdempotentWithoutEventMailOrBump(): void
    {
        $user = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'plain@example.com');
        $before = $this->state($user->getId());

        $t = $this->disableMfa($user->getId());

        $this->assertSame(Command::SUCCESS, $t->getStatusCode());
        $this->assertSame($before, $this->state($user->getId()));
        $c = static::getContainer()->get(Connection::class);
        $this->assertSame(0, (int) $c->fetchOne('SELECT COUNT(*) FROM security_event WHERE user_id = ?', [$user->getId()]));
        $this->assertCount(0, $this->drainMail());
    }

    public function testProfilePathAndCommandLeaveTheSameDbState(): void
    {
        $a = $this->enforcedUser('a@example.com');
        $b = $this->enforcedUser('b@example.com');

        $this->mfa->disable($a, new ClientContext('203.0.113.9', 'Firefox'));
        $this->disableMfa('b@example.com');

        $sa = $this->state($a->getId());
        $sb = $this->state($b->getId());
        unset($sa['tv'], $sb['tv']);
        $this->assertSame($sa, $sb);
        $this->assertSame(['totp' => 0, 'codes' => 0, 'passkeys' => 1, 'enforced' => 0], $sa);
    }
}
