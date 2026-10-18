<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Property;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class PropertyService
{
    public function __construct(
        private EntityManagerInterface $em,
        private UniqueNames $names,
        private UsageCounts $counts,
        private Quota $quota,
    ) {
    }

    public function list(Calendar $calendar): array
    {
        $items = $this->em->getRepository(Property::class)->findBy(['calendar' => $calendar]);

        $usage = $this->counts->propertyUsage($calendar);

        // usage: what deleting the item detaches it from (eventNames only when at most 3 events are affected)
        return array_map(fn (Property $p) => $this->serialize($p) + ['usage' => $usage[$p->getId()] ?? null], $items);
    }

    public function create(Calendar $calendar, array $data): array
    {
        $this->quota->assertRoom(Quota::PROPERTIES_PER_CALENDAR, $calendar);
        $property = new Property();
        $property->setCalendar($calendar);
        $name = Input::string($data, 'name');
        $this->names->assertUnique(Property::class, $calendar, $name);
        $property->setName($name);
        $property->setIcon(Input::nullableString($data, 'icon', 32));

        $this->em->persist($property);
        $this->em->flush();

        return $this->serialize($property);
    }

    public function update(string $id, Calendar $calendar, array $data): array
    {
        $property = $this->find($id, $calendar);

        if (array_key_exists('name', $data)) {
            $name = Input::string($data, 'name');
            $this->names->assertUnique(Property::class, $calendar, $name, $property->getId());
            $property->setName($name);
        }
        if (array_key_exists('icon', $data)) {
            $property->setIcon(Input::nullableString($data, 'icon', 32));
        }

        $this->em->flush();

        return $this->serialize($property);
    }

    public function delete(string $id, Calendar $calendar): void
    {
        $property = $this->find($id, $calendar);
        $this->em->remove($property);
        $this->em->flush();
    }

    private function find(string $id, Calendar $calendar): Property
    {
        $property = $this->em->getRepository(Property::class)->find($id);
        if (!$property || $property->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Property not found');
        }

        return $property;
    }

    public function serialize(Property $property): array
    {
        return [
            'id' => $property->getId(),
            'calendarId' => $property->getCalendar()->getId(),
            'name' => $property->getName(),
            'icon' => $property->getIcon(),
        ];
    }
}
