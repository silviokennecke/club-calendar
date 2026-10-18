<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Club;
use App\Entity\Location;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class LocationService
{
    public function __construct(
        private EntityManagerInterface $em,
        private UsageCounts $counts,
        private Quota $quota,
    ) {
    }

    public function list(Club $club): array
    {
        $items = $this->em->getRepository(Location::class)->findBy(['club' => $club]);

        $usage = $this->counts->locationUsage($club);

        // usage: events / templates at this place (templateNames only when at most 3 templates use it)
        return array_map(fn (Location $l) => $this->serialize($l) + ['usage' => $usage[$l->getId()] ?? null], $items);
    }

    public function create(Club $club, array $data): array
    {
        $this->quota->assertRoom(Quota::LOCATIONS_PER_CLUB, $club);
        $location = $this->build($club, $data);
        $this->em->persist($location);
        $this->em->flush();

        return $this->serialize($location);
    }

    /** New location from request data (validated, not persisted; also used by the atomic import). */
    public function build(Club $club, array $data): Location
    {
        $location = new Location();
        $location->setClub($club);
        $location->setName(Input::nullableString($data, 'name'));
        $location->setStreet(Input::nullableString($data, 'street'));
        $location->setZip(Input::nullableString($data, 'zip', 20));
        $location->setCity(Input::nullableString($data, 'city'));
        $location->setCountry(Input::nullableString($data, 'country', 100));
        [$latitude, $longitude] = self::position(self::coordinate($data, 'latitude', 90), self::coordinate($data, 'longitude', 180));
        $location->setLatitude($latitude);
        $location->setLongitude($longitude);

        return $location;
    }

    /** A coordinate: absent/null or a JSON number within ±$limit, else 400 validation_failed on the field. */
    private static function coordinate(array $data, string $key, int $limit): ?float
    {
        $value = $data[$key] ?? null;
        if (null === $value) {
            return null;
        }
        if (!is_int($value) && !is_float($value)) {
            throw Input::invalid($key, sprintf('%s must be a number', $key));
        }
        if ($value < -$limit || $value > $limit) {
            throw Input::invalid($key, sprintf('%s must be between -%d and %d', $key, $limit, $limit));
        }

        return (float) $value;
    }

    /**
     * A position needs both coordinates (or none).
     *
     * @return array{0: ?float, 1: ?float}
     */
    private static function position(?float $latitude, ?float $longitude): array
    {
        if (null === $latitude && null !== $longitude) {
            throw Input::invalid('latitude', 'latitude and longitude must be given together');
        }
        if (null !== $latitude && null === $longitude) {
            throw Input::invalid('longitude', 'latitude and longitude must be given together');
        }

        return [$latitude, $longitude];
    }

    public function update(string $id, Club $club, array $data): array
    {
        $location = $this->find($id, $club);

        if (array_key_exists('name', $data)) {
            $location->setName(Input::nullableString($data, 'name'));
        }
        if (array_key_exists('street', $data)) {
            $location->setStreet(Input::nullableString($data, 'street'));
        }
        if (array_key_exists('zip', $data)) {
            $location->setZip(Input::nullableString($data, 'zip', 20));
        }
        if (array_key_exists('city', $data)) {
            $location->setCity(Input::nullableString($data, 'city'));
        }
        if (array_key_exists('country', $data)) {
            $location->setCountry(Input::nullableString($data, 'country', 100));
        }
        // Only checked when a coordinate is sent: stored half positions (older data) stay editable
        if (array_key_exists('latitude', $data) || array_key_exists('longitude', $data)) {
            [$latitude, $longitude] = self::position(
                array_key_exists('latitude', $data) ? self::coordinate($data, 'latitude', 90) : $location->getLatitude(),
                array_key_exists('longitude', $data) ? self::coordinate($data, 'longitude', 180) : $location->getLongitude(),
            );
            $location->setLatitude($latitude);
            $location->setLongitude($longitude);
        }

        $this->em->flush();

        return $this->serialize($location);
    }

    public function delete(string $id, Club $club): void
    {
        $location = $this->find($id, $club);
        $this->em->remove($location);
        $this->em->flush();
    }

    private function find(string $id, Club $club): Location
    {
        $location = $this->em->getRepository(Location::class)->find($id);
        if (!$location || $location->getClub()->getId() !== $club->getId()) {
            throw new NotFoundHttpException('Location not found');
        }

        return $location;
    }

    public function serialize(Location $location): array
    {
        return [
            'id' => $location->getId(),
            'clubId' => $location->getClub()->getId(),
            'name' => $location->getName(),
            'street' => $location->getStreet(),
            'zip' => $location->getZip(),
            'city' => $location->getCity(),
            'country' => $location->getCountry(),
            'latitude' => $location->getLatitude(),
            'longitude' => $location->getLongitude(),
            'updatedAt' => $location->getUpdatedAt()->getTimestamp(),
        ];
    }
}
