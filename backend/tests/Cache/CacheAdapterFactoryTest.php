<?php

declare(strict_types=1);

namespace App\Tests\Cache;

use App\Cache\CacheAdapterFactory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Cache\Adapter\FilesystemAdapter;
use Symfony\Component\Cache\Adapter\RedisAdapter;

class CacheAdapterFactoryTest extends TestCase
{
    /** @return iterable<string, array{string}> */
    public static function filesystemDsns(): iterable
    {
        yield 'empty' => [''];
        yield 'filesystem' => ['filesystem'];
        yield 'padded' => [' filesystem '];
    }

    #[DataProvider('filesystemDsns')]
    public function testEmptyOrFilesystemGivesFilesystemAdapter(string $dsn): void
    {
        $dir = sys_get_temp_dir().'/cc-cache-factory-'.bin2hex(random_bytes(4));
        $adapter = (new CacheAdapterFactory($dsn, $dir, 'club-calendar'))->create('pool', 60);

        $this->assertInstanceOf(FilesystemAdapter::class, $adapter);
        $item = $adapter->getItem('k')->set('v');
        $adapter->save($item);
        $this->assertTrue($adapter->getItem('k')->isHit());
        $this->assertDirectoryExists($dir.'/pool');
        $adapter->clear();
    }

    #[DataProvider('redisDsns')]
    public function testRedisSchemesGiveRedisAdapterWithoutConnecting(string $dsn): void
    {
        $adapter = (new CacheAdapterFactory($dsn, '/unused', 'my app'))->create('pool', 60);

        $this->assertInstanceOf(RedisAdapter::class, $adapter);
    }

    /** @return iterable<string, array{string}> */
    public static function redisDsns(): iterable
    {
        yield 'redis' => ['redis://127.0.0.1:1'];
        yield 'rediss' => ['rediss://127.0.0.1:1'];
        yield 'valkey' => ['valkey://127.0.0.1:1'];
    }

    public function testPrefixAndPoolNamespaceAreAppliedToRedisKeys(): void
    {
        $adapter = (new CacheAdapterFactory('redis://127.0.0.1:1', '/unused', 'my app'))->create('pool', 0);

        $ns = new \ReflectionProperty(\Symfony\Component\Cache\Adapter\AbstractAdapter::class, 'namespace');
        $this->assertSame('my-app.pool:', $ns->getValue($adapter));
    }

    #[DataProvider('invalidDsns')]
    public function testInvalidDsnFailsFast(string $dsn): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Unsupported CACHE_DSN');

        (new CacheAdapterFactory($dsn, '/unused', 'p'))->create('pool');
    }

    /** @return iterable<string, array{string}> */
    public static function invalidDsns(): iterable
    {
        yield 'memcached' => ['memcached://localhost'];
        yield 'garbage' => ['not a dsn'];
        yield 'typo' => ['filesytem'];
    }
}
