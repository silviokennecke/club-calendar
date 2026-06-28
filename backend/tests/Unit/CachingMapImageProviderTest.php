<?php
declare(strict_types=1);

namespace App\Tests\Unit;

use App\Service\Map\CachingMapImageProvider;
use App\Service\Map\MapImageProviderInterface;
use PHPUnit\Framework\TestCase;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

class CachingMapImageProviderTest extends TestCase
{
    private function makeCache(): CacheInterface
    {
        $store = [];
        $cache = $this->createMock(CacheInterface::class);
        $cache->method('get')->willReturnCallback(function (string $key, callable $cb) use (&$store) {
            if (!array_key_exists($key, $store)) {
                $store[$key] = $cb($this->createMock(ItemInterface::class));
            }
            return $store[$key];
        });
        return $cache;
    }

    public function testCallsInnerOnCacheMiss(): void
    {
        $inner = $this->createMock(MapImageProviderInterface::class);
        $inner->expects($this->once())->method('getImage')->willReturn('JPEG');

        $result = new CachingMapImageProvider($inner, $this->makeCache())->getImage(11.5, 48.1, 14, 800, 288);

        $this->assertSame('JPEG', $result);
    }

    public function testReturnsCachedResultWithoutCallingInner(): void
    {
        $inner = $this->createMock(MapImageProviderInterface::class);
        $inner->expects($this->once())->method('getImage')->willReturn('JPEG');

        $cache    = $this->makeCache();
        $provider = new CachingMapImageProvider($inner, $cache);
        $provider->getImage(11.5, 48.1, 14, 800, 288);
        $result = $provider->getImage(11.5, 48.1, 14, 800, 288);

        $this->assertSame('JPEG', $result);
    }

    public function testDifferentCoordinatesResultInSeparateCacheEntries(): void
    {
        $inner = $this->createMock(MapImageProviderInterface::class);
        $inner->expects($this->exactly(2))->method('getImage')
            ->willReturnOnConsecutiveCalls('JPEG_A', 'JPEG_B');

        $cache    = $this->makeCache();
        $provider = new CachingMapImageProvider($inner, $cache);
        $a        = $provider->getImage(11.5, 48.1, 14, 800, 288);
        $b        = $provider->getImage(11.6, 48.1, 14, 800, 288);

        $this->assertSame('JPEG_A', $a);
        $this->assertSame('JPEG_B', $b);
    }
}
