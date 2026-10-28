<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Service\Map\BazingaGeocoderAdapter;
use App\Service\Map\GeocodedAddress;
use App\Service\Map\SuggestionResult;
use Geocoder\Geocoder;
use Geocoder\Model\Address;
use Geocoder\Model\AddressCollection;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

class BazingaGeocoderAdapterTest extends TestCase
{
    private function makeAddress(array $data): Address
    {
        return Address::createFromArray($data);
    }

    private function suggestAdapter(array $features, ?array &$captured = null): BazingaGeocoderAdapter
    {
        $client = new MockHttpClient(function (string $method, string $url) use ($features, &$captured) {
            $captured = ['method' => $method, 'url' => $url];

            return new MockResponse(json_encode(['features' => $features]), ['response_headers' => ['content-type: application/json']]);
        });

        return new BazingaGeocoderAdapter($this->createStub(Geocoder::class), $client, 'tok');
    }

    public function testSuggestReturnsAddressResult(): void
    {
        $adapter = $this->suggestAdapter([[
            'place_type' => ['address'],
            'text' => 'Marienplatz',
            'address' => '1',
            'center' => [11.575, 48.137],
            'context' => [
                ['id' => 'postcode.1', 'text' => '80331'],
                ['id' => 'place.2', 'text' => 'München'],
                ['id' => 'country.3', 'text' => 'Deutschland'],
            ],
        ]], $captured);

        $results = $adapter->suggest('Marienplatz 1', 48.1, 11.5, 4);

        $this->assertCount(1, $results);
        $this->assertInstanceOf(SuggestionResult::class, $results[0]);
        $this->assertSame(48.137, $results[0]->lat);
        $this->assertSame(11.575, $results[0]->lng);
        $this->assertSame('Marienplatz 1', $results[0]->street);
        $this->assertSame('80331', $results[0]->zip);
        $this->assertSame('München', $results[0]->city);
        $this->assertNull($results[0]->name);
        $this->assertSame('Marienplatz 1, München, Deutschland', $results[0]->label);
        $this->assertStringContainsString('types=poi%2Caddress', $captured['url']);
        $this->assertStringContainsString('proximity=11.500000%2C48.100000', $captured['url']);
    }

    public function testSuggestReturnsPoiWithNameAndStreet(): void
    {
        $adapter = $this->suggestAdapter([
            [
                'place_type' => ['poi'],
                'text' => 'Schützenhaus',
                'properties' => ['address' => 'Waldweg 1'],
                'center' => [10.0, 50.0],
                'context' => [
                    ['id' => 'neighborhood.9', 'text' => 'Nord'],
                    ['id' => 'postcode.1', 'text' => '12345'],
                    ['id' => 'place.2', 'text' => 'Musterstadt'],
                    ['id' => 'country.3', 'text' => 'Deutschland'],
                ],
            ],
            ['place_type' => ['poi'], 'text' => 'No center'],
        ]);

        $results = $adapter->suggest('Schützenhaus Musterstadt');

        $this->assertCount(1, $results);
        $this->assertSame('Schützenhaus', $results[0]->name);
        $this->assertSame('Waldweg 1', $results[0]->street);
        $this->assertSame('12345', $results[0]->zip);
        $this->assertSame('Musterstadt', $results[0]->city);
        $this->assertSame('Schützenhaus, Waldweg 1, Musterstadt, Deutschland', $results[0]->label);
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

        $adapter = new BazingaGeocoderAdapter($geocoder, new MockHttpClient(), 'tok');
        $result = $adapter->reverse(11.575, 48.137);

        $this->assertInstanceOf(GeocodedAddress::class, $result);
        $this->assertSame('München', $result->city);
        $this->assertStringContainsString('Marienplatz', $result->label);
    }

    public function testReverseReturnsNullWhenNoResults(): void
    {
        $geocoder = $this->createStub(Geocoder::class);
        $geocoder->method('reverseQuery')->willReturn(new AddressCollection([]));

        $adapter = new BazingaGeocoderAdapter($geocoder, new MockHttpClient(), 'tok');
        $this->assertNull($adapter->reverse(0.0, 0.0));
    }
}
