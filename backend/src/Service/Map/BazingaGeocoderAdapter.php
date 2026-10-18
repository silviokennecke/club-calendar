<?php

declare(strict_types=1);

namespace App\Service\Map;

use Geocoder\Geocoder;
use Geocoder\Location;
use Geocoder\Query\ReverseQuery;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class BazingaGeocoderAdapter implements GeocoderInterface
{
    private const string SUGGEST_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places/%s.json';

    public function __construct(
        private readonly Geocoder $geocoder,
        private readonly HttpClientInterface $httpClient,
        private readonly string $mapboxToken,
    ) {
    }

    /**
     * Forward search over addresses and POIs. Calls Mapbox directly instead of the Bazinga provider: the
     * provider cuts the result list at the first feature without `context` and fills the street from the
     * feature `text` (the POI name for a POI) without the street number from `properties.address`.
     */
    public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
    {
        $params = [
            'types' => 'poi,address',
            'language' => 'de',
            'limit' => $limit,
            'access_token' => $this->mapboxToken,
        ];
        if (null !== $proximityLat && null !== $proximityLng) {
            $params['proximity'] = sprintf('%f,%f', $proximityLng, $proximityLat);
        }

        $response = $this->httpClient->request('GET', sprintf(self::SUGGEST_URL, rawurlencode($query)), ['query' => $params]);
        $features = $response->toArray()['features'] ?? [];

        $results = [];
        foreach ($features as $feature) {
            $center = $feature['center'] ?? null;
            if (!is_array($center) || !isset($center[0], $center[1])) {
                continue;
            }

            $context = [];
            foreach ($feature['context'] ?? [] as $component) {
                $type = explode('.', (string) ($component['id'] ?? ''))[0];
                $context[$type] ??= $component['text'] ?? null;
            }

            $isPoi = in_array('poi', $feature['place_type'] ?? [], true);
            $text = isset($feature['text']) ? (string) $feature['text'] : null;
            if ($isPoi) {
                $name = $text;
                $street = $feature['properties']['address'] ?? null;
            } else {
                $name = null;
                $street = null !== $text && isset($feature['address']) ? "$text {$feature['address']}" : $text;
            }
            $city = $context['place'] ?? $context['locality'] ?? null;
            $country = $context['country'] ?? null;

            $parts = array_filter([$name, $street, $city, $country], static fn ($p) => null !== $p && '' !== $p);
            $results[] = new SuggestionResult(
                label: implode(', ', $parts),
                lat: (float) $center[1],
                lng: (float) $center[0],
                street: $street,
                zip: $context['postcode'] ?? null,
                city: $city,
                country: $country,
                name: $name,
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
