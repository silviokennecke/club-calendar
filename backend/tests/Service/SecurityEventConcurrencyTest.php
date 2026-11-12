<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\User;
use App\Enum\SecurityEventType;
use App\Security\ClientContext;
use App\Service\DeferredMailer;
use App\Service\SecurityEventLogger;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\DriverManager;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Parallel failures (real processes via pcntl_fork, own kernel and connection each) fold into one row and one mail. */
class SecurityEventConcurrencyTest extends KernelTestCase
{
    protected function setUp(): void
    {
        if (!function_exists('pcntl_fork')) {
            $this->markTestSkipped('pcntl is required');
        }
    }

    private function user(): User
    {
        self::bootKernel();
        $c = static::getContainer();
        $em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($em);
        $user = TestHelper::createUser($em, $c->get(UserPasswordHasherInterface::class), 'alice@example.com');
        $user->setLanguage('en');
        $em->flush();

        return $user;
    }

    /** @param list<string> $ips one child per entry; mails of all children are counted */
    private function race(User $user, array $ips, ?callable $afterFork = null): int
    {
        $userId = $user->getId();
        $dir = dirname(__DIR__, 2).'/var';
        $startAt = microtime(true) + 3.0;
        static::getContainer()->get(Connection::class)->close();
        self::ensureKernelShutdown();
        $files = $pids = [];
        foreach ($ips as $i => $ip) {
            $files[$i] = tempnam($dir, 'secev-race-');
            $pid = pcntl_fork();
            if (0 === $pid) {
                $mails = -1;
                try {
                    self::ensureKernelShutdown();
                    self::bootKernel();
                    $c = static::getContainer();
                    $em = $c->get(EntityManagerInterface::class);
                    $u = $em->find(User::class, $userId);
                    while (microtime(true) < $startAt) {
                        usleep(500);
                    }
                    $c->get(SecurityEventLogger::class)->record($u, SecurityEventType::LOGIN, false, 'password', null, new ClientContext($ip, 'Chrome 126', 'Berlin', 'DE'));
                    $c->get(DeferredMailer::class)->flush();
                    $mails = count(array_filter(self::getMailerMessages(), fn ($m) => $m instanceof Email));
                } catch (\Throwable) {
                }
                file_put_contents($files[$i], (string) $mails);
                exit(0);
            }
            $this->assertGreaterThan(0, $pid);
            $pids[] = $pid;
        }
        if (null !== $afterFork) {
            $afterFork();
        }
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        $mails = 0;
        foreach ($files as $file) {
            $n = (int) file_get_contents($file);
            $this->assertGreaterThanOrEqual(0, $n, 'child failed');
            $mails += $n;
            unlink($file);
        }
        self::ensureKernelShutdown();
        self::bootKernel();

        return $mails;
    }

    public function testParallelFailuresFoldIntoOneRowAndOneMail(): void
    {
        $user = $this->user();
        $mails = $this->race($user, array_fill(0, 8, '203.0.113.5'));

        $db = static::getContainer()->get(Connection::class);
        $rows = $db->fetchAllAssociative('SELECT attempts FROM security_event');
        $this->assertCount(1, $rows);
        $this->assertSame(8, (int) $rows[0]['attempts']);
        $this->assertSame(1, $mails);
    }

    public function testParallelFailuresFromManyIpsRespectTheDailyCap(): void
    {
        $user = $this->user();
        $cap = SecurityEventLogger::FAILURE_ROWS_PER_DAY;
        $this->race($user, array_map(fn (int $i) => '198.51.100.'.$i, range(1, $cap + 10)));

        $db = static::getContainer()->get(Connection::class);
        $this->assertSame($cap, (int) $db->fetchOne('SELECT COUNT(*) FROM security_event'));
        $this->assertSame($cap + 10, (int) $db->fetchOne('SELECT SUM(attempts) FROM security_event'));
    }

    public function testLockTimeoutLosesNoAttemptsAndReturnsFast(): void
    {
        $user = $this->user();
        $name = 'secev:'.$user->getId();
        $params = static::getContainer()->get(Connection::class)->getParams();
        $holder = null;
        $started = microtime(true);
        try {
            // a foreign connection (opened after the forks, children would share its socket) holds the per-user lock for the whole race
            $this->race($user, array_fill(0, 10, '203.0.113.5'), function () use (&$holder, $name, $params): void {
                $holder = DriverManager::getConnection($params);
                $this->assertSame(1, (int) $holder->fetchOne('SELECT GET_LOCK(?, 1)', [$name]));
            });
            $elapsed = microtime(true) - $started;
            $db = static::getContainer()->get(Connection::class);
            $rows = $db->fetchAllAssociative('SELECT attempts FROM security_event');
            $this->assertCount(1, $rows);
            $this->assertSame(10, (int) $rows[0]['attempts']);
            // 3 s head start of the race + well below the old 3 s lock wait per request
            $this->assertLessThan(3.0 + 2.0, $elapsed);
        } finally {
            $holder?->executeStatement('DO RELEASE_LOCK(?)', [$name]);
            $holder?->close();
        }
    }
}
