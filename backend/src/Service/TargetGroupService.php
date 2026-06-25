<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\TargetGroup;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class TargetGroupService
{
    public function __construct(private EntityManagerInterface $em) {}

    public function list(Calendar $calendar): array
    {
        $items = $this->em->getRepository(TargetGroup::class)->findBy(['calendar' => $calendar]);

        return array_map(fn (TargetGroup $tg) => $this->serialize($tg), $items);
    }

    public function create(Calendar $calendar, array $data): array
    {
        $targetGroup = new TargetGroup();
        $targetGroup->setCalendar($calendar);
        $targetGroup->setName($data['name']);

        $this->em->persist($targetGroup);
        $this->em->flush();

        return $this->serialize($targetGroup);
    }

    public function update(int $id, Calendar $calendar, array $data): array
    {
        $targetGroup = $this->find($id, $calendar);

        if (array_key_exists('name', $data)) {
            $targetGroup->setName($data['name']);
        }

        $this->em->flush();

        return $this->serialize($targetGroup);
    }

    public function delete(int $id, Calendar $calendar): void
    {
        $targetGroup = $this->find($id, $calendar);
        $this->em->remove($targetGroup);
        $this->em->flush();
    }

    private function find(int $id, Calendar $calendar): TargetGroup
    {
        $targetGroup = $this->em->getRepository(TargetGroup::class)->find($id);
        if (!$targetGroup || $targetGroup->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Target group not found');
        }

        return $targetGroup;
    }

    public function serialize(TargetGroup $targetGroup): array
    {
        return [
            'id'         => $targetGroup->getId(),
            'calendarId' => $targetGroup->getCalendar()->getId(),
            'name'       => $targetGroup->getName(),
        ];
    }
}
