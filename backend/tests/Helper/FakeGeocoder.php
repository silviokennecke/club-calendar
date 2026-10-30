<?php

declare(strict_types=1);

namespace App\Tests\Helper;

use Geocoder\Collection;
use Geocoder\Model\Address;
use Geocoder\Model\AddressCollection;
use Geocoder\Provider\Provider;
use Geocoder\Query\GeocodeQuery;
use Geocoder\Query\ReverseQuery;

/** Geocoder stub: closures return a Collection or throw; default is an empty result. */
class FakeGeocoder implements Provider
{
    /**
     * @param (\Closure(GeocodeQuery): Collection)|null $geocode
     * @param (\Closure(ReverseQuery): Collection)|null $reverse
     */
    public function __construct(private readonly ?\Closure $geocode = null, private readonly ?\Closure $reverse = null)
    {
    }

    public function geocodeQuery(GeocodeQuery $query): Collection
    {
        return null !== $this->geocode ? ($this->geocode)($query) : new AddressCollection([]);
    }

    public function reverseQuery(ReverseQuery $query): Collection
    {
        return null !== $this->reverse ? ($this->reverse)($query) : new AddressCollection([]);
    }

    public function getName(): string
    {
        return 'fake';
    }

    /** @param array<string, mixed> $data */
    public static function collection(array ...$data): AddressCollection
    {
        return new AddressCollection(array_map(static fn (array $d): Address => Address::createFromArray($d), $data));
    }
}
