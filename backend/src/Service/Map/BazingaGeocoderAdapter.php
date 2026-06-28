<?php
declare(strict_types=1);

namespace App\Service\Map;

use Geocoder\Geocoder;
use Geocoder\Location;
use Geocoder\Query\GeocodeQuery;
use Geocoder\Query\ReverseQuery;

class BazingaGeocoderAdapter implements GeocoderInterface
{
    public function __construct(private readonly Geocoder $geocoder) {}

    public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
    {
        $geoQuery = GeocodeQuery::create($query)->withLimit($limit);
        if ($proximityLat !== null && $proximityLng !== null) {
            $geoQuery = $geoQuery->withData('proximity', sprintf('%f,%f', $proximityLng, $proximityLat));
        }

        $collection = $this->geocoder->geocodeQuery($geoQuery);
        $results    = [];

        foreach ($collection as $address) {
            $coords = $address->getCoordinates();
            if ($coords === null) {
                continue;
            }
            $results[] = new SuggestionResult(
                label:   $this->buildLabel($address),
                lat:     $coords->getLatitude(),
                lng:     $coords->getLongitude(),
                street:  $this->buildStreet($address),
                zip:     $address->getPostalCode(),
                city:    $address->getLocality(),
                country: $address->getCountry()?->getName(),
            );
        }

        return $results;
    }

    public function reverse(float $lng, float $lat): ?GeocodedAddress
    {
        $collection = $this->geocoder->reverseQuery(ReverseQuery::fromCoordinates($lat, $lng));

        if ($collection->isEmpty()) {
            return null;
        }

        $address = $collection->first();

        return new GeocodedAddress(
            label:   $this->buildLabel($address),
            street:  $this->buildStreet($address),
            zip:     $address->getPostalCode(),
            city:    $address->getLocality(),
            country: $address->getCountry()?->getName(),
        );
    }

    private function buildLabel(Location $address): string
    {
        $parts = array_filter([
            $this->buildStreet($address),
            $address->getLocality(),
            $address->getCountry()?->getName(),
        ]);

        return implode(', ', $parts);
    }

    private function buildStreet(Location $address): ?string
    {
        $name = $address->getStreetName();
        if ($name === null) {
            return null;
        }
        $number = $address->getStreetNumber();

        return $number !== null ? "$name $number" : $name;
    }
}
