<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Entity\User;
use App\Tests\Helper\DatabaseResetter;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Mime\Email;

/** app:opaque:notify-legacy and app:opaque:retire-legacy (AP 14). */
class OpaqueLegacyCommandsTest extends KernelTestCase
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

    private function boot(string $enabled = 'true', string $cutoff = '2026-12-01'): void
    {
        foreach (['OPAQUE_ENABLED' => $enabled, 'OPAQUE_ROLLOUT_PERCENT' => '100', 'OPAQUE_LEGACY_CUTOFF' => $cutoff] as $name => $value) {
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

    private function add(string $email, bool $bcrypt = true, bool $record = false, bool $verified = true, string $language = 'de'): User
    {
        $user = (new User())->setName('Ada')->setEmail($email)->setIsEmailVerified($verified)->setLanguage($language);
        if ($bcrypt) {
            $user->setPassword(self::BCRYPT);
        }
        if ($record) {
            $user->setOpaque(str_repeat("\x01", 192), 1, '1');
        }
        $this->em()->persist($user);
        $this->em()->flush();

        return $user;
    }

    private function exec(string $name, array $input = []): CommandTester
    {
        $tester = new CommandTester((new Application(self::$kernel))->find($name));
        $tester->execute($input);

        return $tester;
    }

    private function reminderDays(User $user): ?int
    {
        $this->em()->clear();

        return $this->em()->find(User::class, $user->getId())->getOpaqueReminderDays();
    }

    public function testSendsTheFirstReminderOnlyToConfirmedBcryptOnlyAccounts(): void
    {
        $this->boot();
        static::mockTime('2026-11-17 10:00:00 UTC');
        $due = $this->add('due@example.com');
        $this->add('record@example.com', true, true);
        $this->add('sso@example.com', false);
        $this->add('unverified@example.com', true, false, false);

        $tester = $this->exec('app:opaque:notify-legacy');

        self::assertSame(0, $tester->getStatusCode());
        self::assertEmailCount(1);
        self::assertEmailAddressContains(self::getMailerMessage(), 'to', 'due@example.com');
        self::assertSame(14, $this->reminderDays($due));
    }

    public function testIsIdempotentPerStage(): void
    {
        $this->boot();
        static::mockTime('2026-11-20 10:00:00 UTC');
        $this->add('due@example.com');

        $this->exec('app:opaque:notify-legacy');
        $this->exec('app:opaque:notify-legacy');
        self::assertEmailCount(1);

        // Later the same day-range: still nothing new.
        static::mockTime('2026-11-25 10:00:00 UTC');
        $this->exec('app:opaque:notify-legacy');
        self::assertEmailCount(1);

        // The 3-day stage follows once.
        static::mockTime('2026-11-28 23:00:00 UTC');
        $this->exec('app:opaque:notify-legacy');
        $this->exec('app:opaque:notify-legacy');
        self::assertEmailCount(2);
    }

    public function testNothingMoreThanFourteenDaysAheadAndNothingAfterTheCutoff(): void
    {
        $this->boot();
        $this->add('due@example.com');

        static::mockTime('2026-11-16 23:59:59 UTC');
        $this->exec('app:opaque:notify-legacy');
        self::assertEmailCount(0);

        static::mockTime('2026-12-01 00:00:00 UTC');
        $this->exec('app:opaque:notify-legacy');
        self::assertEmailCount(0);
    }

    public function testStageBoundariesInUtc(): void
    {
        $this->boot();
        $user = $this->add('due@example.com');

        // 2026-11-17 00:00 UTC is exactly 14 days before 2026-12-01.
        static::mockTime('2026-11-17 00:00:00 UTC');
        $this->exec('app:opaque:notify-legacy');
        self::assertSame(14, $this->reminderDays($user));

        // 3 days before: 2026-11-28.
        static::mockTime('2026-11-27 23:59:59 UTC');
        $this->exec('app:opaque:notify-legacy');
        self::assertSame(14, $this->reminderDays($user));
        static::mockTime('2026-11-28 00:00:00 UTC');
        $this->exec('app:opaque:notify-legacy');
        self::assertSame(3, $this->reminderDays($user));
    }

    public function testMissedFirstStageSendsOnlyTheShortReminder(): void
    {
        $this->boot();
        static::mockTime('2026-11-29 10:00:00 UTC');
        $user = $this->add('late@example.com');

        $this->exec('app:opaque:notify-legacy');

        self::assertEmailCount(1);
        self::assertSame(3, $this->reminderDays($user));
    }

    public function testDryRunSendsAndStoresNothing(): void
    {
        $this->boot();
        static::mockTime('2026-11-20 10:00:00 UTC');
        $user = $this->add('due@example.com');

        $tester = $this->exec('app:opaque:notify-legacy', ['--dry-run' => true]);

        self::assertStringContainsString('Would send 1', $tester->getDisplay());
        self::assertEmailCount(0);
        self::assertNull($this->reminderDays($user));
    }

    public function testLimitSpreadsTheMailsOverRuns(): void
    {
        $this->boot();
        static::mockTime('2026-11-20 10:00:00 UTC');
        $this->add('a@example.com');
        $this->add('b@example.com');

        $this->exec('app:opaque:notify-legacy', ['--limit' => 1]);
        self::assertEmailCount(1);
        $this->exec('app:opaque:notify-legacy', ['--limit' => 1]);
        self::assertEmailCount(2);
        $this->exec('app:opaque:notify-legacy', ['--limit' => 1]);
        self::assertEmailCount(2);
    }

    public function testNothingWithoutFlagOrCutoff(): void
    {
        static::mockTime('2026-11-20 10:00:00 UTC');
        $this->boot('false');
        $this->add('due@example.com');
        $this->exec('app:opaque:notify-legacy');
        self::assertEmailCount(0);

        $this->boot('true', '');
        $this->add('due@example.com');
        $this->exec('app:opaque:notify-legacy');
        self::assertEmailCount(0);
    }

    public function testMailHasOnlyLoginAndForgotPasswordLinks(): void
    {
        $this->boot();
        static::mockTime('2026-11-20 10:00:00 UTC');
        $this->add('due@example.com');
        $this->add('en@example.com', true, false, true, 'en');

        $this->exec('app:opaque:notify-legacy');

        $mails = self::getMailerMessages();
        self::assertCount(2, $mails);
        $bodies = [];
        foreach ($mails as $mail) {
            self::assertInstanceOf(Email::class, $mail);
            $html = (string) $mail->getHtmlBody();
            $bodies[] = $html;
            preg_match_all('/href="(https?:[^"]+)"/', $html, $m);
            $base = rtrim((string) $_SERVER['FRONTEND_URL'], '/');
            foreach (array_unique($m[1]) as $url) {
                self::assertContains($url, [$base.'/login', $base.'/forgot-password'], $url);
            }
            self::assertStringNotContainsString('token=', $html);
        }
        self::assertStringContainsString('01.12.2026', $bodies[0]);
        self::assertStringContainsString('2026-12-01', $bodies[1]);
    }

    public function testRetireRefusesBeforeTheCutoffAndWhenDisabled(): void
    {
        $this->boot();
        static::mockTime('2026-11-30 23:59:59 UTC');
        $user = $this->add('a@example.com');

        $tester = $this->exec('app:opaque:retire-legacy', ['--force' => true]);
        self::assertSame(1, $tester->getStatusCode());
        self::assertSame(self::BCRYPT, $this->em()->find(User::class, $user->getId())->getPassword());

        $this->boot('true', '');
        $this->add('a@example.com');
        self::assertSame(1, $this->exec('app:opaque:retire-legacy', ['--force' => true])->getStatusCode());

        $this->boot('false');
        static::mockTime('2026-12-02 00:00:00 UTC');
        $this->add('a@example.com');
        self::assertSame(1, $this->exec('app:opaque:retire-legacy', ['--force' => true])->getStatusCode());
    }

    public function testRetireDryRunCountsAndChangesNothing(): void
    {
        $this->boot();
        static::mockTime('2026-12-01 00:00:00 UTC');
        $this->add('a@example.com');
        $this->add('b@example.com');
        $this->add('c@example.com', true, true);
        $this->add('d@example.com', false, true);
        $this->add('e@example.com', false);

        $tester = $this->exec('app:opaque:retire-legacy');

        self::assertSame(0, $tester->getStatusCode());
        self::assertMatchesRegularExpression('/\(must reset the password\)\s+2\s/', $tester->getDisplay());
        self::assertMatchesRegularExpression('/\(leftover hash\)\s+1\s/', $tester->getDisplay());
        self::assertStringContainsString('Dry run', $tester->getDisplay());
        self::assertSame(3, (int) $this->em()->getConnection()->fetchOne('SELECT COUNT(*) FROM `user` WHERE password IS NOT NULL'));
    }

    public function testRetireForceDeletesAllHashesAndKeepsRecords(): void
    {
        $this->boot();
        static::mockTime('2026-12-01 00:00:00 UTC');
        $legacy = $this->add('a@example.com');
        $both = $this->add('c@example.com', true, true);
        $record = $this->add('d@example.com', false, true);

        $tester = $this->exec('app:opaque:retire-legacy', ['--force' => true]);

        self::assertSame(0, $tester->getStatusCode());
        self::assertStringContainsString('Deleted 2 bcrypt hash(es)', $tester->getDisplay());
        $this->em()->clear();
        self::assertNull($this->em()->find(User::class, $legacy->getId())->getPassword());
        self::assertNull($this->em()->find(User::class, $both->getId())->getPassword());
        self::assertNotNull($this->em()->find(User::class, $both->getId())->getOpaqueRecord());
        self::assertNotNull($this->em()->find(User::class, $record->getId())->getOpaqueRecord());
    }
}
