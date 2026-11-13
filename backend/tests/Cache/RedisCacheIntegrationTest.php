<?php

declare(strict_types=1);

namespace App\Tests\Cache;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Cache\Adapter\RedisAdapter;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\RateLimiter\RateLimiterFactory;
use Symfony\Component\RateLimiter\Storage\CacheStorage;

/** Runs only against a real Redis: TEST_CACHE_DSN=redis://127.0.0.1:6379 */
class RedisCacheIntegrationTest extends KernelTestCase
{
    protected function setUp(): void
    {
        $dsn = (string) (getenv('TEST_CACHE_DSN') ?: '');
        if ('' === $dsn) {
            $this->markTestSkipped('TEST_CACHE_DSN not set.');
        }
        putenv('CACHE_DSN='.$dsn);
        $_ENV['CACHE_DSN'] = $_SERVER['CACHE_DSN'] = $dsn;
    }

    protected function tearDown(): void
    {
        putenv('CACHE_DSN');
        unset($_ENV['CACHE_DSN'], $_SERVER['CACHE_DSN']);
        parent::tearDown();
    }

    private function freshContainer(): ContainerInterface
    {
        self::ensureKernelShutdown();
        self::bootKernel();

        return self::getContainer();
    }

    public function testRoundTripAndSharedAcrossKernelInstances(): void
    {
        $a = $this->freshContainer();
        $pool = $a->get('map_images');
        $this->assertInstanceOf(RedisAdapter::class, $pool);
        $key = 'it_'.bin2hex(random_bytes(4));
        $pool->save($pool->getItem($key)->set('hello'));
        $this->assertSame('hello', $pool->getItem($key)->get());

        $other = $this->freshContainer()->get('map_images');
        $this->assertNotSame($pool, $other);
        $this->assertSame('hello', $other->getItem($key)->get());

        $other->deleteItem($key);
        $this->assertFalse($pool->getItem($key)->isHit());
    }

    public function testRateLimiterStateIsSharedAcrossKernelInstances(): void
    {
        $key = 'it-'.bin2hex(random_bytes(4));
        $factory = fn (): RateLimiterFactory => new RateLimiterFactory(
            ['id' => 'it_cache', 'policy' => 'fixed_window', 'limit' => 10, 'interval' => '1 hour'],
            new CacheStorage($this->freshContainer()->get('cache.rate_limiter')),
        );

        $this->assertTrue($factory()->create($key)->consume(7)->isAccepted());
        $this->assertFalse($factory()->create($key)->consume(7)->isAccepted());
        $this->assertSame(3, $factory()->create($key)->consume(0)->getRemainingTokens());
    }
}
