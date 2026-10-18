<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\TargetGroup;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class TargetGroupService
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
        $items = $this->em->getRepository(TargetGroup::class)->findBy(['calendar' => $calendar]);

        $usage = $this->counts->targetGroupUsage($calendar);

        // usage: what deleting the item detaches it from (eventNames only when at most 3 events are affected)
        return array_map(fn (TargetGroup $tg) => $this->serialize($tg) + ['usage' => $usage[$tg->getId()] ?? null], $items);
    }

    public function create(Calendar $calendar, array $data): array
    {
        $this->quota->assertRoom(Quota::TARGET_GROUPS_PER_CALENDAR, $calendar);
        $targetGroup = new TargetGroup();
        $targetGroup->setCalendar($calendar);
        $name = Input::string($data, 'name');
        $this->names->assertUnique(TargetGroup::class, $calendar, $name);
        $targetGroup->setName($name);

        $this->em->persist($targetGroup);
        $this->em->flush();

        return $this->serialize($targetGroup);
    }

    public function update(string $id, Calendar $calendar, array $data): array
    {
        $targetGroup = $this->find($id, $calendar);

        if (array_key_exists('name', $data)) {
            $name = Input::string($data, 'name');
            $this->names->assertUnique(TargetGroup::class, $calendar, $name, $targetGroup->getId());
            $targetGroup->setName($name);
        }

        $this->em->flush();

        return $this->serialize($targetGroup);
    }

    public function delete(string $id, Calendar $calendar): void
    {
        $targetGroup = $this->find($id, $calendar);
        $this->em->remove($targetGroup);
        $this->em->flush();
    }

    private function find(string $id, Calendar $calendar): TargetGroup
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
            'id' => $targetGroup->getId(),
            'calendarId' => $targetGroup->getCalendar()->getId(),
            'name' => $targetGroup->getName(),
        ];
    }
}
