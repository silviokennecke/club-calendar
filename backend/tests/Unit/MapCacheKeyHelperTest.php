<?php
declare(strict_types=1);

namespace App\Tests\Unit;

use App\Service\Map\MapCacheKeyHelper;
use PHPUnit\Framework\TestCase;

class MapCacheKeyHelperTest extends TestCase
{
    public function testForGeocoderSuggestReturnsSha256(): void
    {
        $key = MapCacheKeyHelper::forGeocoderSuggest('München', 48.1, 11.5, 6);
        $this->assertSame(64, strlen($key));
        $this->assertMatchesRegularExpression('/^[a-f0-9]+$/', $key);
    }

    public function testForGeocoderSuggestDiffersOnQuery(): void
    {
        $a = MapCacheKeyHelper::forGeocoderSuggest('Berlin', 48.1, 11.5, 6);
        $b = MapCacheKeyHelper::forGeocoderSuggest('München', 48.1, 11.5, 6);
        $this->assertNotSame($a, $b);
    }

    public function testForGeocoderSuggestDiffersOnLimit(): void
    {
        $a = MapCacheKeyHelper::forGeocoderSuggest('München', 48.1, 11.5, 6);
        $b = MapCacheKeyHelper::forGeocoderSuggest('München', 48.1, 11.5, 10);
        $this->assertNotSame($a, $b);
    }

    public function testForGeocoderSuggestIsDeterministic(): void
    {
        $a = MapCacheKeyHelper::forGeocoderSuggest('München', 48.1, 11.5, 6);
        $b = MapCacheKeyHelper::forGeocoderSuggest('München', 48.1, 11.5, 6);
        $this->assertSame($a, $b);
    }

    public function testForGeocoderReverseReturnsSha256(): void
    {
        $key = MapCacheKeyHelper::forGeocoderReverse(11.5, 48.1);
        $this->assertSame(64, strlen($key));
    }

    public function testForGeocoderReverseIsDeterministic(): void
    {
        $this->assertSame(
            MapCacheKeyHelper::forGeocoderReverse(11.5, 48.1),
            MapCacheKeyHelper::forGeocoderReverse(11.5, 48.1),
        );
    }

    public function testForMapImageIsDeterministic(): void
    {
        $a = MapCacheKeyHelper::forMapImage(11.5, 48.1, 14, 800, 288);
        $b = MapCacheKeyHelper::forMapImage(11.5, 48.1, 14, 800, 288);
        $this->assertSame($a, $b);
    }

    public function testForMapImageDiffersOnCoordinates(): void
    {
        $a = MapCacheKeyHelper::forMapImage(11.5, 48.1, 14, 800, 288);
        $b = MapCacheKeyHelper::forMapImage(11.6, 48.1, 14, 800, 288);
        $this->assertNotSame($a, $b);
    }

    public function testForProxyRequestStripsAccessToken(): void
    {
        $with    = MapCacheKeyHelper::forProxyRequest('GET', '/v4/tile', ['access_token' => 'secret', 'x' => '1']);
        $without = MapCacheKeyHelper::forProxyRequest('GET', '/v4/tile', ['x' => '1']);
        $this->assertSame($with, $without);
    }

    public function testForProxyRequestIsDeterministicRegardlessOfParamOrder(): void
    {
        $a = MapCacheKeyHelper::forProxyRequest('GET', '/v4/tile', ['x' => '1', 'y' => '2']);
        $b = MapCacheKeyHelper::forProxyRequest('GET', '/v4/tile', ['y' => '2', 'x' => '1']);
        $this->assertSame($a, $b);
    }
}
