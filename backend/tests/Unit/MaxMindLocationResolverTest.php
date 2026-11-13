<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Security\HeaderCountryLocationResolver;
use App\Security\LocationResolverFactory;
use App\Security\MaxMindLocationResolver;
use App\Service\GeoIpDatabase;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Symfony\Component\HttpFoundation\Request;

class MaxMindLocationResolverTest extends TestCase
{
    private const string DB = __DIR__.'/../fixtures/geoip/GeoIP2-City-Test.mmdb';

    private function database(?string $file): GeoIpDatabase
    {
        $db = $this->createStub(GeoIpDatabase::class);
        $db->method('localPath')->willReturn($file);

        return $db;
    }

    private function request(string $ip, ?string $acceptLanguage = null): Request
    {
        Request::setTrustedProxies([], Request::HEADER_X_FORWARDED_FOR);
        $request = Request::create('/', 'GET', [], [], [], ['REMOTE_ADDR' => $ip]);
        if (null !== $acceptLanguage) {
            $request->headers->set('Accept-Language', $acceptLanguage);
        }

        return $request;
    }

    public function testResolvesCityAndCountry(): void
    {
        $location = (new MaxMindLocationResolver($this->database(self::DB), new NullLogger()))->resolve($this->request('81.2.69.142'));
        $this->assertSame('London', $location->city);
        $this->assertSame('GB', $location->country);
    }

    public function testUsesGermanNameWhenPreferredAndAvailable(): void
    {
        $resolver = new MaxMindLocationResolver($this->database(self::DB), new NullLogger());
        $this->assertSame('Linköping', $resolver->resolve($this->request('89.160.20.112', 'de-DE,de;q=0.9'))->city);
        // no German name in the database: English fallback
        $this->assertSame('Boxford', $resolver->resolve($this->request('2.125.160.216', 'de'))->city);
    }

    public function testPrivateAndUnknownAddressesAreEmpty(): void
    {
        $resolver = new MaxMindLocationResolver($this->database(self::DB), new NullLogger());
        foreach (['10.0.0.1', '127.0.0.1', '192.168.1.5', '8.8.8.8'] as $ip) {
            $location = $resolver->resolve($this->request($ip));
            $this->assertNull($location->city, $ip);
            $this->assertNull($location->country, $ip);
        }
    }

    public function testMissingDatabaseIsEmpty(): void
    {
        $resolver = new MaxMindLocationResolver($this->database(null), new NullLogger());
        $this->assertNull($resolver->resolve($this->request('81.2.69.142'))->country);
        $this->assertNull($resolver->resolve($this->request('81.2.69.142'))->country);
    }

    public function testFactoryPicksByLicenseKey(): void
    {
        $maxMind = new MaxMindLocationResolver($this->database(self::DB), new NullLogger());
        $header = new HeaderCountryLocationResolver('CF-IPCountry');
        $factory = new LocationResolverFactory($maxMind, $header);

        $this->assertSame($maxMind, $factory->create('key'));
        $this->assertSame($header, $factory->create(''));
        $this->assertSame($header, $factory->create('  '));
    }
}
