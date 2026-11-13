<?php

declare(strict_types=1);

namespace App\Tests\Cache;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Cache\Adapter\FilesystemAdapter;
use Symfony\Component\Cache\Adapter\RedisAdapter;
use Symfony\Component\DependencyInjection\ContainerInterface;

class CacheBackendWiringTest extends KernelTestCase
{
    protected function tearDown(): void
    {
        putenv('CACHE_DSN');
        unset($_ENV['CACHE_DSN'], $_SERVER['CACHE_DSN']);
        parent::tearDown();
    }

    private function bootWithDsn(string $dsn): ContainerInterface
    {
        putenv('CACHE_DSN='.$dsn);
        $_ENV['CACHE_DSN'] = $_SERVER['CACHE_DSN'] = $dsn;
        self::ensureKernelShutdown();
        self::bootKernel();

        return self::getContainer();
    }

    public function testRedisDsnMovesAppCachePoolsAndLimiterToRedis(): void
    {
        $c = $this->bootWithDsn('redis://127.0.0.1:1');

        $this->assertInstanceOf(RedisAdapter::class, $c->get('cache.app'));
        $this->assertInstanceOf(RedisAdapter::class, $c->get('map_images'));
        $this->assertInstanceOf(RedisAdapter::class, $c->get('holiday_sources'));
        $this->assertInstanceOf(RedisAdapter::class, $c->get('cache.rate_limiter'));

        $this->assertNotInstanceOf(RedisAdapter::class, $c->get('cache.system'));
        $this->assertNotInstanceOf(RedisAdapter::class, $c->get('scheduler_state'));
    }

    public function testDefaultStaysFilesystem(): void
    {
        $c = $this->bootWithDsn('');

        $this->assertInstanceOf(FilesystemAdapter::class, $c->get('cache.app'));
        $this->assertInstanceOf(FilesystemAdapter::class, $c->get('map_images'));
        $this->assertInstanceOf(FilesystemAdapter::class, $c->get('cache.rate_limiter'));
    }
}
