<?php
declare(strict_types=1);

namespace App\Tests\Unit;

use App\Service\Map\CachingGeocoderDecorator;
use App\Service\Map\GeocodedAddress;
use App\Service\Map\GeocoderInterface;
use App\Service\Map\SuggestionResult;
use PHPUnit\Framework\TestCase;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

class CachingGeocoderDecoratorTest extends TestCase
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

    public function testSuggestCallsInnerOnCacheMiss(): void
    {
        $suggestion = new SuggestionResult('München', 48.1, 11.5);
        $inner      = $this->createMock(GeocoderInterface::class);
        $inner->expects($this->once())->method('suggest')->willReturn([$suggestion]);

        $result = new CachingGeocoderDecorator($inner, $this->makeCache())->suggest('München');

        $this->assertCount(1, $result);
        $this->assertSame('München', $result[0]->label);
    }

    public function testSuggestReturnsCachedResultWithoutCallingInner(): void
    {
        $suggestion = new SuggestionResult('München', 48.1, 11.5);
        $inner      = $this->createMock(GeocoderInterface::class);
        $inner->expects($this->once())->method('suggest')->willReturn([$suggestion]);

        $decorator = new CachingGeocoderDecorator($inner, $this->makeCache());
        $decorator->suggest('München');
        $result = $decorator->suggest('München');

        $this->assertCount(1, $result);
    }

    public function testReverseCallsInnerOnCacheMiss(): void
    {
        $address = new GeocodedAddress('Marienplatz', 'Marienplatz', '80331', 'München', 'Germany');
        $inner   = $this->createMock(GeocoderInterface::class);
        $inner->expects($this->once())->method('reverse')->willReturn($address);

        $result = new CachingGeocoderDecorator($inner, $this->makeCache())->reverse(11.575, 48.137);

        $this->assertSame('Marienplatz', $result?->label);
    }

    public function testReverseReturnsCachedResultWithoutCallingInner(): void
    {
        $address = new GeocodedAddress('Marienplatz', 'Marienplatz', '80331', 'München', 'Germany');
        $inner   = $this->createMock(GeocoderInterface::class);
        $inner->expects($this->once())->method('reverse')->willReturn($address);

        $decorator = new CachingGeocoderDecorator($inner, $this->makeCache());
        $decorator->reverse(11.575, 48.137);
        $result = $decorator->reverse(11.575, 48.137);

        $this->assertSame('Marienplatz', $result?->label);
    }
}
