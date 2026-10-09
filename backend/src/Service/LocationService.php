<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Location;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class LocationService
{
    public function __construct(
        private EntityManagerInterface $em,
        private UsageCounts $counts,
    ) {
    }

    public function list(Calendar $calendar): array
    {
        $items = $this->em->getRepository(Location::class)->findBy(['calendar' => $calendar]);

        $usage = $this->counts->locationUsage($calendar);

        // usage: events / templates at this place (templateNames only when at most 3 templates use it)
        return array_map(fn (Location $l) => $this->serialize($l) + ['usage' => $usage[$l->getId()] ?? null], $items);
    }

    public function create(Calendar $calendar, array $data): array
    {
        $location = new Location();
        $location->setCalendar($calendar);
        $location->setName(Input::nullableString($data, 'name'));
        $location->setStreet(Input::nullableString($data, 'street'));
        $location->setZip(Input::nullableString($data, 'zip', 20));
        $location->setCity(Input::nullableString($data, 'city'));
        $location->setCountry(Input::nullableString($data, 'country', 100));
        $location->setLatitude(isset($data['latitude']) ? (float) $data['latitude'] : null);
        $location->setLongitude(isset($data['longitude']) ? (float) $data['longitude'] : null);

        $this->em->persist($location);
        $this->em->flush();

        return $this->serialize($location);
    }

    public function update(string $id, Calendar $calendar, array $data): array
    {
        $location = $this->find($id, $calendar);

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
        if (array_key_exists('latitude', $data)) {
            $location->setLatitude(null !== $data['latitude'] ? (float) $data['latitude'] : null);
        }
        if (array_key_exists('longitude', $data)) {
            $location->setLongitude(null !== $data['longitude'] ? (float) $data['longitude'] : null);
        }

        $this->em->flush();

        return $this->serialize($location);
    }

    public function delete(string $id, Calendar $calendar): void
    {
        $location = $this->find($id, $calendar);
        $this->em->remove($location);
        $this->em->flush();
    }

    private function find(string $id, Calendar $calendar): Location
    {
        $location = $this->em->getRepository(Location::class)->find($id);
        if (!$location || $location->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Location not found');
        }

        return $location;
    }

    public function serialize(Location $location): array
    {
        return [
            'id' => $location->getId(),
            'calendarId' => $location->getCalendar()->getId(),
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
