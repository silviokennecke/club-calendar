<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Feature;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class FeatureService
{
    public function __construct(private EntityManagerInterface $em)
    {
    }

    public function list(Calendar $calendar): array
    {
        $items = $this->em->getRepository(Feature::class)->findBy(['calendar' => $calendar]);

        return array_map(fn (Feature $f) => $this->serialize($f), $items);
    }

    public function create(Calendar $calendar, array $data): array
    {
        $feature = new Feature();
        $feature->setCalendar($calendar);
        $feature->setName(Input::string($data, 'name'));

        $this->em->persist($feature);
        $this->em->flush();

        return $this->serialize($feature);
    }

    public function update(string $id, Calendar $calendar, array $data): array
    {
        $feature = $this->find($id, $calendar);

        if (array_key_exists('name', $data)) {
            $feature->setName(Input::string($data, 'name'));
        }

        $this->em->flush();

        return $this->serialize($feature);
    }

    public function delete(string $id, Calendar $calendar): void
    {
        $feature = $this->find($id, $calendar);
        $this->em->remove($feature);
        $this->em->flush();
    }

    private function find(string $id, Calendar $calendar): Feature
    {
        $feature = $this->em->getRepository(Feature::class)->find($id);
        if (!$feature || $feature->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Feature not found');
        }

        return $feature;
    }

    public function serialize(Feature $feature): array
    {
        return [
            'id' => $feature->getId(),
            'calendarId' => $feature->getCalendar()->getId(),
            'name' => $feature->getName(),
        ];
    }
}
