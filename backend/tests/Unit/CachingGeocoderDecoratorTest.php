<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Service\Map\CachingGeocoderDecorator;
use App\Tests\Helper\FakeGeocoder;
use Geocoder\Provider\Provider;
use Geocoder\Query\GeocodeQuery;
use Geocoder\Query\ReverseQuery;
use PHPUnit\Framework\TestCase;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

class CachingGeocoderDecoratorTest extends TestCase
{
    private function makeCache(): CacheInterface
    {
        $store = [];
        $cache = $this->createStub(CacheInterface::class);
        $cache->method('get')->willReturnCallback(function (string $key, callable $cb) use (&$store) {
            if (!array_key_exists($key, $store)) {
                $store[$key] = $cb($this->createStub(ItemInterface::class));
            }

            return $store[$key];
        });

        return $cache;
    }

    public function testGeocodeCallsInnerOnCacheMiss(): void
    {
        $inner = $this->createMock(Provider::class);
        $inner->expects($this->once())->method('geocodeQuery')
            ->willReturn(FakeGeocoder::collection(['latitude' => 48.1, 'longitude' => 11.5, 'locality' => 'München']));

        $result = new CachingGeocoderDecorator($inner, $this->makeCache())->geocodeQuery(GeocodeQuery::create('München'));

        $this->assertCount(1, $result);
        $this->assertSame('München', $result->first()->getLocality());
    }

    public function testGeocodeReturnsCachedResultWithoutCallingInner(): void
    {
        $inner = $this->createMock(Provider::class);
        $inner->expects($this->once())->method('geocodeQuery')
            ->willReturn(FakeGeocoder::collection(['locality' => 'München']));

        $decorator = new CachingGeocoderDecorator($inner, $this->makeCache());
        $decorator->geocodeQuery(GeocodeQuery::create('München'));
        $result = $decorator->geocodeQuery(GeocodeQuery::create('München'));

        $this->assertCount(1, $result);
    }

    public function testGeocodeLimitIsPartOfTheKey(): void
    {
        $inner = $this->createMock(Provider::class);
        $inner->expects($this->exactly(2))->method('geocodeQuery')->willReturn(FakeGeocoder::collection());

        $decorator = new CachingGeocoderDecorator($inner, $this->makeCache());
        $decorator->geocodeQuery(GeocodeQuery::create('München')->withLimit(3));
        $decorator->geocodeQuery(GeocodeQuery::create('München')->withLimit(6));
    }

    public function testReverseCallsInnerOnCacheMiss(): void
    {
        $inner = $this->createMock(Provider::class);
        $inner->expects($this->once())->method('reverseQuery')
            ->willReturn(FakeGeocoder::collection(['streetName' => 'Marienplatz']));

        $result = new CachingGeocoderDecorator($inner, $this->makeCache())->reverseQuery(ReverseQuery::fromCoordinates(48.137, 11.575));

        $this->assertSame('Marienplatz', $result->first()->getStreetName());
    }

    public function testReverseReturnsCachedResultWithoutCallingInner(): void
    {
        $inner = $this->createMock(Provider::class);
        $inner->expects($this->once())->method('reverseQuery')
            ->willReturn(FakeGeocoder::collection(['streetName' => 'Marienplatz']));

        $decorator = new CachingGeocoderDecorator($inner, $this->makeCache());
        $decorator->reverseQuery(ReverseQuery::fromCoordinates(48.137, 11.575));
        $result = $decorator->reverseQuery(ReverseQuery::fromCoordinates(48.137, 11.575));

        $this->assertSame('Marienplatz', $result->first()->getStreetName());
    }
}
