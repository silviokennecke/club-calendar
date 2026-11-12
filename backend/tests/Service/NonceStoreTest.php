<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Security\NonceStore;
use App\Tests\Helper\DatabaseResetter;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/** Single winner per key, also for parallel real processes (pcntl_fork) on an expired key, in and outside transactions. */
class NonceStoreTest extends KernelTestCase
{
    protected function setUp(): void
    {
        self::bootKernel();
        DatabaseResetter::reset(static::getContainer()->get(EntityManagerInterface::class));
    }

    private function store(): NonceStore
    {
        return static::getContainer()->get(NonceStore::class);
    }

    public function testLiveKeyIsConsumedOnlyOnce(): void
    {
        $this->assertTrue($this->store()->consume('t', 'k', time() + 300));
        $this->assertFalse($this->store()->consume('t', 'k', time() + 300));
        $this->assertFalse($this->store()->consume('t', 'k', time() + 900));
        $this->assertTrue($this->store()->isConsumed('t', 'k'));
        $this->assertTrue($this->store()->consume('t', 'other', time() + 300));
        $this->assertTrue($this->store()->consume('u', 'k', time() + 300));
    }

    public function testExpiredKeyCanBeConsumedAgainThenIsLive(): void
    {
        $this->assertTrue($this->store()->consume('slot', 'jti#1', time() - 120));
        $this->assertTrue($this->store()->consume('slot', 'jti#1', time() + 300));
        $this->assertFalse($this->store()->consume('slot', 'jti#1', time() + 300));
        $this->assertSame(1, (int) static::getContainer()->get(Connection::class)->fetchOne('SELECT COUNT(*) FROM auth_nonce'));
    }

    public function testAlreadyExpiredNewExpiryDoesNotReopenLiveKey(): void
    {
        $this->assertTrue($this->store()->consume('t', 'k', time() + 300));
        $this->assertFalse($this->store()->consume('t', 'k', time() - 300));
        $this->assertFalse($this->store()->consume('t', 'k', time() + 300));
    }

    public function testParallelConsumersOfExpiredKeyHaveExactlyOneWinner(): void
    {
        if (!function_exists('pcntl_fork')) {
            $this->markTestSkipped('pcntl is required');
        }
        foreach ([false, true] as $inTransaction) {
            $key = 'race-'.($inTransaction ? 'tx' : 'auto');
            $this->assertTrue($this->store()->consume('race', $key, time() - 120));
            $results = $this->race($key, $inTransaction);
            $this->assertCount(16, $results);
            $this->assertSame(['ok'], array_values(array_unique(array_map(fn ($r) => 'ok' === $r || 'dup' === $r ? 'ok' : $r, $results))), implode(',', $results));
            $this->assertSame(1, count(array_filter($results, fn ($r) => 'ok' === $r)), implode(',', $results));
            $this->assertTrue($this->store()->isConsumed('race', $key));
        }
    }

    /** @return list<string> ok = winner, dup = false, otherwise the exception class */
    private function race(string $key, bool $inTransaction): array
    {
        $dir = dirname(__DIR__, 2).'/var';
        $startAt = microtime(true) + 3.0;
        static::getContainer()->get(Connection::class)->close();
        self::ensureKernelShutdown();
        $files = $pids = [];
        for ($i = 0; $i < 16; ++$i) {
            $files[$i] = tempnam($dir, 'nonce-race-');
            $pid = pcntl_fork();
            if (0 === $pid) {
                $out = 'child failed';
                try {
                    self::bootKernel();
                    $c = static::getContainer();
                    $db = $c->get(Connection::class);
                    $store = $c->get(NonceStore::class);
                    $db->executeQuery('SELECT 1');
                    while (microtime(true) < $startAt) {
                        usleep(300);
                    }
                    if ($inTransaction) {
                        $db->beginTransaction();
                    }
                    $out = $store->consume('race', $key, time() + 300) ? 'ok' : 'dup';
                    if ($inTransaction) {
                        $db->commit();
                    }
                } catch (\Throwable $e) {
                    $out = $e::class;
                }
                file_put_contents($files[$i], $out);
                exit(0);
            }
            $this->assertGreaterThan(0, $pid);
            $pids[] = $pid;
        }
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        $results = [];
        foreach ($files as $file) {
            $results[] = (string) file_get_contents($file);
            unlink($file);
        }
        self::ensureKernelShutdown();
        self::bootKernel();

        return $results;
    }
}
