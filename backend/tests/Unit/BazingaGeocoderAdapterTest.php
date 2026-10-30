<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Service\Map\BazingaGeocoderAdapter;
use App\Service\Map\GeocodedAddress;
use App\Service\Map\SuggestionResult;
use Geocoder\Geocoder;
use Geocoder\Model\Address;
use Geocoder\Model\AddressCollection;
use Geocoder\Query\GeocodeQuery;
use PHPUnit\Framework\TestCase;

class BazingaGeocoderAdapterTest extends TestCase
{
    private function makeAddress(array $data): Address
    {
        return Address::createFromArray($data);
    }

    /** @param Address[] $addresses */
    private function suggestAdapter(array $addresses, ?GeocodeQuery &$captured = null): BazingaGeocoderAdapter
    {
        $geocoder = $this->createStub(Geocoder::class);
        $geocoder->method('geocodeQuery')->willReturnCallback(function (GeocodeQuery $q) use ($addresses, &$captured) {
            $captured = $q;

            return new AddressCollection($addresses);
        });

        return new BazingaGeocoderAdapter($geocoder);
    }

    public function testSuggestReturnsAddressResult(): void
    {
        $adapter = $this->suggestAdapter([
            $this->makeAddress([
                'latitude' => 48.137,
                'longitude' => 11.575,
                'streetName' => 'Marienplatz',
                'streetNumber' => '1',
                'postalCode' => '80331',
                'locality' => 'München',
                'country' => 'Deutschland',
            ]),
            $this->makeAddress(['streetName' => 'No coordinates']),
        ], $captured);

        $results = $adapter->suggest('Marienplatz 1', 48.1, 11.5, 4);

        $this->assertCount(1, $results);
        $this->assertInstanceOf(SuggestionResult::class, $results[0]);
        $this->assertSame(48.137, $results[0]->lat);
        $this->assertSame(11.575, $results[0]->lng);
        $this->assertSame('Marienplatz 1', $results[0]->street);
        $this->assertSame('80331', $results[0]->zip);
        $this->assertSame('München', $results[0]->city);
        $this->assertSame('Deutschland', $results[0]->country);
        $this->assertSame('Marienplatz 1, 80331 München, Deutschland', $results[0]->label);
        $this->assertSame('Marienplatz 1', $captured->getText());
        $this->assertSame(4, $captured->getLimit());
    }

    public function testSuggestWithoutStreetNumberOrZip(): void
    {
        $adapter = $this->suggestAdapter([
            $this->makeAddress(['latitude' => 10.0, 'longitude' => 50.0, 'streetName' => 'Waldweg', 'locality' => 'Musterstadt']),
        ]);

        $results = $adapter->suggest('Waldweg');

        $this->assertSame('Waldweg', $results[0]->street);
        $this->assertNull($results[0]->zip);
        $this->assertSame('Waldweg, Musterstadt', $results[0]->label);
    }

    public function testSuggestReturnsEmptyArrayWhenNoResults(): void
    {
        $this->assertSame([], $this->suggestAdapter([])->suggest('nowhere special xyz'));
    }

    public function testReverseReturnsGeocodedAddress(): void
    {
        $geocoder = $this->createStub(Geocoder::class);
        $address = $this->makeAddress([
            'latitude' => 48.137,
            'longitude' => 11.575,
            'streetName' => 'Marienplatz',
            'locality' => 'München',
            'countryName' => 'Germany',
        ]);
        $geocoder->method('reverseQuery')->willReturn(new AddressCollection([$address]));

        $adapter = new BazingaGeocoderAdapter($geocoder);
        $result = $adapter->reverse(11.575, 48.137);

        $this->assertInstanceOf(GeocodedAddress::class, $result);
        $this->assertSame('München', $result->city);
        $this->assertStringContainsString('Marienplatz', $result->label);
    }

    public function testReverseReturnsNullWhenNoResults(): void
    {
        $geocoder = $this->createStub(Geocoder::class);
        $geocoder->method('reverseQuery')->willReturn(new AddressCollection([]));

        $adapter = new BazingaGeocoderAdapter($geocoder);
        $this->assertNull($adapter->reverse(0.0, 0.0));
    }
}
