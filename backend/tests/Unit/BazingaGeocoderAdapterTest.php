<?php
declare(strict_types=1);

namespace App\Tests\Unit;

use App\Service\Map\BazingaGeocoderAdapter;
use App\Service\Map\GeocodedAddress;
use App\Service\Map\SuggestionResult;
use Geocoder\Collection;
use Geocoder\Geocoder;
use Geocoder\Model\Address;
use Geocoder\Model\AddressCollection;
use Geocoder\Query\GeocodeQuery;
use Geocoder\Query\ReverseQuery;
use PHPUnit\Framework\TestCase;

class BazingaGeocoderAdapterTest extends TestCase
{
    private function makeAddress(array $data): Address
    {
        return Address::createFromArray($data);
    }

    public function testSuggestReturnsNormalizedResults(): void
    {
        $geocoder = $this->createMock(Geocoder::class);
        $address  = $this->makeAddress([
            'latitude'     => 48.137,
            'longitude'    => 11.575,
            'streetName'   => 'Marienplatz',
            'streetNumber' => '1',
            'postalCode'   => '80331',
            'locality'     => 'München',
            'countryName'  => 'Germany',
        ]);
        $geocoder->method('geocodeQuery')->willReturn(new AddressCollection([$address]));

        $adapter = new BazingaGeocoderAdapter($geocoder);
        $results = $adapter->suggest('Marienplatz');

        $this->assertCount(1, $results);
        $this->assertInstanceOf(SuggestionResult::class, $results[0]);
        $this->assertSame(48.137, $results[0]->lat);
        $this->assertSame(11.575, $results[0]->lng);
        $this->assertSame('München', $results[0]->city);
        $this->assertSame('80331', $results[0]->zip);
        $this->assertStringContainsString('Marienplatz', $results[0]->label);
    }

    public function testSuggestReturnsEmptyArrayWhenNoResults(): void
    {
        $geocoder = $this->createMock(Geocoder::class);
        $geocoder->method('geocodeQuery')->willReturn(new AddressCollection([]));

        $adapter = new BazingaGeocoderAdapter($geocoder);
        $this->assertSame([], $adapter->suggest('nowhere special xyz'));
    }

    public function testReverseReturnsGeocodedAddress(): void
    {
        $geocoder = $this->createMock(Geocoder::class);
        $address  = $this->makeAddress([
            'latitude'    => 48.137,
            'longitude'   => 11.575,
            'streetName'  => 'Marienplatz',
            'locality'    => 'München',
            'countryName' => 'Germany',
        ]);
        $geocoder->method('reverseQuery')->willReturn(new AddressCollection([$address]));

        $adapter = new BazingaGeocoderAdapter($geocoder);
        $result  = $adapter->reverse(11.575, 48.137);

        $this->assertInstanceOf(GeocodedAddress::class, $result);
        $this->assertSame('München', $result->city);
        $this->assertStringContainsString('Marienplatz', $result->label);
    }

    public function testReverseReturnsNullWhenNoResults(): void
    {
        $geocoder = $this->createMock(Geocoder::class);
        $geocoder->method('reverseQuery')->willReturn(new AddressCollection([]));

        $adapter = new BazingaGeocoderAdapter($geocoder);
        $this->assertNull($adapter->reverse(0.0, 0.0));
    }
}
