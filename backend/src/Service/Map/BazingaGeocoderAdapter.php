<?php

declare(strict_types=1);

namespace App\Service\Map;

use Geocoder\Geocoder;
use Geocoder\Location;
use Geocoder\Query\GeocodeQuery;
use Geocoder\Query\ReverseQuery;

class BazingaGeocoderAdapter implements GeocoderInterface
{
    public function __construct(private readonly Geocoder $geocoder)
    {
    }

    /** Address search; the Bazinga Mapbox provider has no proximity option, so the hint is ignored. */
    public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
    {
        $collection = $this->geocoder->geocodeQuery(GeocodeQuery::create($query)->withLimit($limit));

        $results = [];
        foreach ($collection as $location) {
            $coordinates = $location->getCoordinates();
            if (null === $coordinates) {
                continue;
            }

            $street = $this->buildStreet($location);
            $zip = $location->getPostalCode();
            $city = $location->getLocality();
            $country = $location->getCountry()?->getName();
            $zipCity = trim(($zip ?? '').' '.($city ?? ''));

            $label = implode(', ', array_filter([$street, $zipCity, $country], static fn ($p) => null !== $p && '' !== $p));

            $results[] = new SuggestionResult(
                label: $label,
                lat: $coordinates->getLatitude(),
                lng: $coordinates->getLongitude(),
                street: $street,
                zip: $zip,
                city: $city,
                country: $country,
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
            label: $this->buildLabel($address),
            street: $this->buildStreet($address),
            zip: $address->getPostalCode(),
            city: $address->getLocality(),
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
        if (null === $name) {
            return null;
        }
        $number = $address->getStreetNumber();

        return null !== $number ? "$name $number" : $name;
    }
}
