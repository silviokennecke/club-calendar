<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Club;
use App\Entity\Location;
use App\Entity\Resource;
use App\Enum\ResourceType;
use App\Enum\ResourceVisibility;
use App\Exception\ApiProblemException;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class ResourceService
{
    public const MAX_BUFFER_MINUTES = 1440;
    public const DUPLICATE_CODE = 'duplicate_resource';

    public function __construct(
        private EntityManagerInterface $em,
        private Quota $quota,
    ) {
    }

    public function list(Club $club): array
    {
        $items = $this->em->getRepository(Resource::class)->findBy(['club' => $club], ['name' => 'ASC', 'id' => 'ASC']);

        return array_map($this->serialize(...), $items);
    }

    /** Plain members: only `members` resources, minimal fields (no settings of the booking rules). */
    public function listForMember(Club $club): array
    {
        $items = $this->em->getRepository(Resource::class)->findBy(['club' => $club, 'visibility' => ResourceVisibility::MEMBERS], ['name' => 'ASC', 'id' => 'ASC']);

        return array_map(fn (Resource $r) => [
            'id' => $r->getId(),
            'name' => $r->getName(),
            'type' => $r->getType()->value,
            'locationId' => $r->getLocation()->getId(),
        ], $items);
    }

    public function create(Club $club, array $data): array
    {
        $this->quota->assertRoom(Quota::RESOURCES_PER_CLUB, $club);

        $resource = new Resource();
        $resource->setClub($club);
        $resource->setType(self::type($data));
        $resource->setName(trim(Input::string($data, 'name')));
        $resource->setLocation($this->location($club, $data));
        if (array_key_exists('visibility', $data)) {
            $resource->setVisibility(self::visibility($data));
        }
        if (array_key_exists('allowDoubleBooking', $data)) {
            $resource->setAllowDoubleBooking(Input::bool($data, 'allowDoubleBooking'));
        }
        if (array_key_exists('bufferMinutes', $data)) {
            $resource->setBufferMinutes(self::buffer($data));
        }

        $this->em->persist($resource);
        $this->em->flush();

        return $this->serialize($resource);
    }

    public function update(string $id, Club $club, array $data): array
    {
        $resource = $this->find($id, $club);

        if (array_key_exists('name', $data)) {
            $resource->setName(trim(Input::string($data, 'name')));
        }
        if (array_key_exists('visibility', $data)) {
            $resource->setVisibility(self::visibility($data));
        }
        if (array_key_exists('allowDoubleBooking', $data)) {
            $resource->setAllowDoubleBooking(Input::bool($data, 'allowDoubleBooking'));
        }
        if (array_key_exists('bufferMinutes', $data)) {
            $resource->setBufferMinutes(self::buffer($data));
        }
        $this->em->flush();

        return $this->serialize($resource);
    }

    public function delete(string $id, Club $club): void
    {
        $this->em->remove($this->find($id, $club));
        $this->em->flush();
    }

    private function find(string $id, Club $club): Resource
    {
        $resource = $this->em->getRepository(Resource::class)->find($id);
        if (!$resource || $resource->getClub()->getId() !== $club->getId()) {
            throw new NotFoundHttpException('Resource not found');
        }

        return $resource;
    }

    /** The location must belong to the club and not be a resource yet. */
    private function location(Club $club, array $data): Location
    {
        $id = Input::string($data, 'locationId', 36);
        $location = $this->em->getRepository(Location::class)->find($id);
        if (!$location || $location->getClub()->getId() !== $club->getId()) {
            throw new ApiProblemException(422, 'locationId: unknown location', CalendarReferences::CODE, 'locationId');
        }
        if (null !== $this->em->getRepository(Resource::class)->findOneBy(['location' => $location])) {
            throw new ApiProblemException(422, 'locationId: the location is already a resource', self::DUPLICATE_CODE, 'locationId');
        }

        return $location;
    }

    private static function type(array $data): ResourceType
    {
        if (!array_key_exists('type', $data)) {
            return ResourceType::LOCATION;
        }

        return ResourceType::tryFrom(is_string($data['type']) ? $data['type'] : '')
            ?? throw Input::invalid('type', 'type must be one of: '.implode(', ', ResourceType::values()));
    }

    private static function visibility(array $data): ResourceVisibility
    {
        return ResourceVisibility::tryFrom(is_string($data['visibility'] ?? null) ? $data['visibility'] : '')
            ?? throw Input::invalid('visibility', 'visibility must be one of: '.implode(', ', ResourceVisibility::values()));
    }

    private static function buffer(array $data): int
    {
        $value = $data['bufferMinutes'];
        if (!is_int($value) || $value < 0 || $value > self::MAX_BUFFER_MINUTES) {
            throw Input::invalid('bufferMinutes', sprintf('bufferMinutes must be an integer between 0 and %d', self::MAX_BUFFER_MINUTES));
        }

        return $value;
    }

    public function serialize(Resource $resource): array
    {
        return [
            'id' => $resource->getId(),
            'clubId' => $resource->getClub()->getId(),
            'type' => $resource->getType()->value,
            'name' => $resource->getName(),
            'locationId' => $resource->getLocation()->getId(),
            'visibility' => $resource->getVisibility()->value,
            'allowDoubleBooking' => $resource->isAllowDoubleBooking(),
            'bufferMinutes' => $resource->getBufferMinutes(),
            'updatedAt' => $resource->getUpdatedAt()->getTimestamp(),
        ];
    }
}
