<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Entity\PasswordReset;
use App\Entity\User;
use App\Tests\Helper\DatabaseResetter;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

/** Password-set links of app:user:create / app:user:set-password and the legacy-password rules (AP 16). */
class UserLinkModeCommandsTest extends KernelTestCase
{
    use ClockSensitiveTrait;

    private const array VARS = ['OPAQUE_ENABLED', 'OPAQUE_ROLLOUT_PERCENT', 'OPAQUE_LEGACY_CUTOFF'];
    private const string BCRYPT = '$2y$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';

    /** @var array<string, string|null> */
    private array $saved = [];

    protected function setUp(): void
    {
        foreach (self::VARS as $name) {
            $this->saved[$name] = $_SERVER[$name] ?? null;
        }
    }

    protected function tearDown(): void
    {
        static::mockTime(false);
        foreach ($this->saved as $name => $value) {
            if (null === $value) {
                unset($_SERVER[$name], $_ENV[$name]);
                putenv($name);
            } else {
                $_SERVER[$name] = $_ENV[$name] = $value;
                putenv("$name=$value");
            }
        }
        parent::tearDown();
    }

    /** $cutoff: '' none, 'past' reached, 'future' not yet. */
    private function boot(string $enabled, string $cutoff = ''): void
    {
        $date = match ($cutoff) {
            'past' => '2020-01-01',
            'future' => '2999-01-01',
            default => '',
        };
        foreach (['OPAQUE_ENABLED' => $enabled, 'OPAQUE_ROLLOUT_PERCENT' => '100', 'OPAQUE_LEGACY_CUTOFF' => $date] as $name => $value) {
            $_SERVER[$name] = $_ENV[$name] = $value;
            putenv("$name=$value");
        }
        static::ensureKernelShutdown();
        self::bootKernel();
        DatabaseResetter::reset($this->em());
    }

    private function em(): EntityManagerInterface
    {
        return static::getContainer()->get(EntityManagerInterface::class);
    }

    /** @param array<string, mixed> $input */
    private function exec(string $name, array $input, bool $interactive = false): CommandTester
    {
        $t = new CommandTester((new Application(self::$kernel))->find($name));
        $t->execute($input, ['interactive' => $interactive]);

        return $t;
    }

    private function byEmail(string $email): ?User
    {
        $this->em()->clear();

        return $this->em()->getRepository(User::class)->findOneBy(['email' => $email]);
    }

    private function assertLink(CommandTester $t): void
    {
        $this->assertSame(1, preg_match('~/reset-password\?token=[0-9a-f]{64}~', $t->getDisplay()), $t->getDisplay());
    }

    private function legacyUser(string $email, bool $record = false): User
    {
        $user = (new User())->setName('Ada')->setEmail($email)->setIsEmailVerified(true)->setPassword(self::BCRYPT);
        if ($record) {
            $user->setOpaque(str_repeat("\x01", 192), 1, '1');
        }
        $this->em()->persist($user);
        $this->em()->flush();

        return $user;
    }

    // --- app:user:create ---

    public function testCreateWithOpaqueDefaultsToPasswordlessUserAndLink(): void
    {
        $this->boot('true');
        $t = $this->exec('app:user:create', ['--name' => 'Ada', '--email' => 'a@example.com']);

        $this->assertSame(Command::SUCCESS, $t->getStatusCode(), $t->getDisplay());
        $this->assertLink($t);
        $user = $this->byEmail('a@example.com');
        $this->assertNotNull($user);
        $this->assertNull($user->getPassword());
        $this->assertTrue($user->isEmailVerified());
        $reset = $this->em()->getRepository(PasswordReset::class)->findOneBy(['user' => $user]);
        $this->assertNotNull($reset);
    }

    public function testCreateLinkFlagWorksWithoutOpaqueToo(): void
    {
        $this->boot('false');
        $t = $this->exec('app:user:create', ['--name' => 'Ada', '--email' => 'a@example.com', '--link' => true]);

        $this->assertSame(Command::SUCCESS, $t->getStatusCode(), $t->getDisplay());
        $this->assertLink($t);
        $this->assertNull($this->byEmail('a@example.com')?->getPassword());
    }

    public function testCreateLinkAndPasswordTogetherIsRefused(): void
    {
        $this->boot('true');
        $t = $this->exec('app:user:create', ['--name' => 'Ada', '--email' => 'a@example.com', '--link' => true, '--password' => 'secret-pass-1']);

        $this->assertSame(Command::FAILURE, $t->getStatusCode());
        $this->assertNull($this->byEmail('a@example.com'));
    }

    public function testCreateWithOpaqueAndPasswordWarnsBeforeTheCutoff(): void
    {
        $this->boot('true', 'future');
        $t = $this->exec('app:user:create', ['--name' => 'Ada', '--email' => 'a@example.com', '--password' => 'secret-pass-1']);

        $this->assertSame(Command::SUCCESS, $t->getStatusCode(), $t->getDisplay());
        $this->assertStringContainsString('legacy (bcrypt)', $t->getDisplay());
        $this->assertStringNotContainsString('secret-pass-1', $t->getDisplay());
        $this->assertStringNotContainsString('reset-password', $t->getDisplay());
        $this->assertNotNull($this->byEmail('a@example.com')?->getPassword());
    }

    public function testCreateWithOpaqueAndPasswordWithoutCutoffWarns(): void
    {
        $this->boot('true');
        $t = $this->exec('app:user:create', ['--name' => 'Ada', '--email' => 'a@example.com', '--password' => 'secret-pass-1']);

        $this->assertSame(Command::SUCCESS, $t->getStatusCode());
        $this->assertStringContainsString('legacy (bcrypt)', $t->getDisplay());
    }

    public function testCreateWithPasswordAfterTheCutoffIsRefusedWithoutForce(): void
    {
        $this->boot('true', 'past');
        $t = $this->exec('app:user:create', ['--name' => 'Ada', '--email' => 'a@example.com', '--password' => 'secret-pass-1']);

        $this->assertSame(Command::FAILURE, $t->getStatusCode());
        $this->assertStringContainsString('--force-legacy', $t->getDisplay());
        $this->assertNull($this->byEmail('a@example.com'));
    }

    public function testCreateWithPasswordAfterTheCutoffAndForceLegacyWarnsAndCreates(): void
    {
        $this->boot('true', 'past');
        $t = $this->exec('app:user:create', ['--name' => 'Ada', '--email' => 'a@example.com', '--password' => 'secret-pass-1', '--force-legacy' => true]);

        $this->assertSame(Command::SUCCESS, $t->getStatusCode(), $t->getDisplay());
        $this->assertStringContainsString('legacy (bcrypt)', $t->getDisplay());
        $this->assertNotNull($this->byEmail('a@example.com')?->getPassword());
    }

    public function testCreateAfterTheCutoffWithoutPasswordStillGivesALink(): void
    {
        $this->boot('true', 'past');
        $t = $this->exec('app:user:create', ['--name' => 'Ada', '--email' => 'a@example.com']);

        $this->assertSame(Command::SUCCESS, $t->getStatusCode(), $t->getDisplay());
        $this->assertLink($t);
    }

    public function testCreateWithOpaqueOffAndPasswordIsUnchangedEvenAfterACutoff(): void
    {
        $this->boot('false', 'past');
        $t = $this->exec('app:user:create', ['--name' => 'Ada', '--email' => 'a@example.com', '--password' => 'secret-pass-1']);

        $this->assertSame(Command::SUCCESS, $t->getStatusCode(), $t->getDisplay());
        $this->assertStringNotContainsString('legacy', $t->getDisplay());
        $this->assertNotNull($this->byEmail('a@example.com')?->getPassword());
    }

    public function testCreateWithOpaqueOffAndNoPasswordStillNeedsOne(): void
    {
        $this->boot('false');
        $t = $this->exec('app:user:create', ['--name' => 'Ada', '--email' => 'a@example.com']);

        $this->assertSame(Command::FAILURE, $t->getStatusCode());
        $this->assertStringContainsString('password is missing', $t->getDisplay());
    }

    // --- app:user:set-password ---

    public function testSetPasswordWithOpaqueDefaultsToLinkClearsCredentialsAndEndsSessions(): void
    {
        $this->boot('true');
        $user = $this->legacyUser('s@example.com', true);
        $t = $this->exec('app:user:set-password', ['user' => 's@example.com']);

        $this->assertSame(Command::SUCCESS, $t->getStatusCode(), $t->getDisplay());
        $this->assertLink($t);
        $after = $this->byEmail('s@example.com');
        $this->assertNull($after->getPassword());
        $this->assertFalse($after->hasPasswordCredential());
        $this->assertSame(1, $after->getTokenVersion());
        $this->assertSame(1, $this->em()->getRepository(PasswordReset::class)->count(['user' => $after, 'usedAt' => null]));
        $this->assertSame($user->getId(), $after->getId());
    }

    public function testSetPasswordLinkFlagVoidsEarlierLinksWithoutOpaque(): void
    {
        $this->boot('false');
        $this->legacyUser('s@example.com');
        $first = $this->exec('app:user:set-password', ['user' => 's@example.com', '--link' => true]);
        $second = $this->exec('app:user:set-password', ['user' => 's@example.com', '--link' => true]);

        $this->assertLink($first);
        $this->assertLink($second);
        $this->assertNotSame($first->getDisplay(), $second->getDisplay());
        $this->assertSame(1, $this->em()->getRepository(PasswordReset::class)->count(['usedAt' => null]));
    }

    public function testSetPasswordLinkAndPasswordTogetherIsRefused(): void
    {
        $this->boot('true');
        $this->legacyUser('s@example.com');
        $t = $this->exec('app:user:set-password', ['user' => 's@example.com', '--link' => true, '--password' => 'new-password-1']);

        $this->assertSame(Command::FAILURE, $t->getStatusCode());
        $this->assertNotNull($this->byEmail('s@example.com')->getPassword());
    }

    public function testSetPasswordWithOpaqueAndPasswordWarnsAndClearsTheRecord(): void
    {
        $this->boot('true', 'future');
        $this->legacyUser('s@example.com', true);
        $t = $this->exec('app:user:set-password', ['user' => 's@example.com', '--password' => 'new-password-1']);

        $this->assertSame(Command::SUCCESS, $t->getStatusCode(), $t->getDisplay());
        $this->assertStringContainsString('legacy (bcrypt)', $t->getDisplay());
        $this->assertStringNotContainsString('new-password-1', $t->getDisplay());
        $user = $this->byEmail('s@example.com');
        $this->assertNotNull($user->getPassword());
        $this->assertNull($user->getOpaqueRecord());
        $this->assertSame(1, $user->getTokenVersion());
    }

    public function testSetPasswordAfterTheCutoffNeedsForceLegacy(): void
    {
        $this->boot('true', 'past');
        $this->legacyUser('s@example.com');
        $refused = $this->exec('app:user:set-password', ['user' => 's@example.com', '--password' => 'new-password-1']);

        $this->assertSame(Command::FAILURE, $refused->getStatusCode());
        $this->assertSame(0, $this->byEmail('s@example.com')->getTokenVersion());

        $forced = $this->exec('app:user:set-password', ['user' => 's@example.com', '--password' => 'new-password-1', '--force-legacy' => true]);
        $this->assertSame(Command::SUCCESS, $forced->getStatusCode(), $forced->getDisplay());
        $this->assertStringContainsString('legacy (bcrypt)', $forced->getDisplay());
    }

    public function testSetPasswordWithOpaqueOffIsUnchanged(): void
    {
        $this->boot('false', 'past');
        $this->legacyUser('s@example.com');
        $t = $this->exec('app:user:set-password', ['user' => 's@example.com', '--password' => 'new-password-1']);

        $this->assertSame(Command::SUCCESS, $t->getStatusCode(), $t->getDisplay());
        $this->assertStringNotContainsString('legacy', $t->getDisplay());
        $this->assertStringNotContainsString('reset-password', $t->getDisplay());
    }
}
