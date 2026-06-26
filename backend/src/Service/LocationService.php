<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Location;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class LocationService
{
    public function __construct(private EntityManagerInterface $em) {}

    public function list(Calendar $calendar): array
    {
        $items = $this->em->getRepository(Location::class)->findBy(['calendar' => $calendar]);

        return array_map(fn (Location $l) => $this->serialize($l), $items);
    }

    public function create(Calendar $calendar, array $data): array
    {
        $location = new Location();
        $location->setCalendar($calendar);
        $location->setName($data['name'] ?? null);
        $location->setStreet($data['street'] ?? null);
        $location->setZip($data['zip'] ?? null);
        $location->setCity($data['city'] ?? null);
        $location->setCountry($data['country'] ?? null);
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
            $location->setName($data['name']);
        }
        if (array_key_exists('street', $data)) {
            $location->setStreet($data['street']);
        }
        if (array_key_exists('zip', $data)) {
            $location->setZip($data['zip']);
        }
        if (array_key_exists('city', $data)) {
            $location->setCity($data['city']);
        }
        if (array_key_exists('country', $data)) {
            $location->setCountry($data['country']);
        }
        if (array_key_exists('latitude', $data)) {
            $location->setLatitude($data['latitude'] !== null ? (float) $data['latitude'] : null);
        }
        if (array_key_exists('longitude', $data)) {
            $location->setLongitude($data['longitude'] !== null ? (float) $data['longitude'] : null);
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
            'id'         => $location->getId(),
            'calendarId' => $location->getCalendar()->getId(),
            'name'       => $location->getName(),
            'street'     => $location->getStreet(),
            'zip'        => $location->getZip(),
            'city'       => $location->getCity(),
            'country'    => $location->getCountry(),
            'latitude'   => $location->getLatitude(),
            'longitude'  => $location->getLongitude(),
        ];
    }
}
