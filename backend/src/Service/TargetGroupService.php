<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Club;
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

    public function list(Club $club): array
    {
        $items = $this->em->getRepository(TargetGroup::class)->findBy(['club' => $club]);

        $usage = $this->counts->targetGroupUsage($club);

        // usage: what deleting the item detaches it from (eventNames only when at most 3 events are affected)
        return array_map(fn (TargetGroup $tg) => $this->serialize($tg) + ['usage' => $usage[$tg->getId()] ?? null], $items);
    }

    public function create(Club $club, array $data): array
    {
        $this->quota->assertRoom(Quota::TARGET_GROUPS_PER_CLUB, $club);
        $targetGroup = new TargetGroup();
        $targetGroup->setClub($club);
        $name = Input::string($data, 'name');
        $this->names->assertUnique(TargetGroup::class, $club, $name);
        $targetGroup->setName($name);

        $this->em->persist($targetGroup);
        $this->em->flush();

        return $this->serialize($targetGroup);
    }

    public function update(string $id, Club $club, array $data): array
    {
        $targetGroup = $this->find($id, $club);

        if (array_key_exists('name', $data)) {
            $name = Input::string($data, 'name');
            $this->names->assertUnique(TargetGroup::class, $club, $name, $targetGroup->getId());
            $targetGroup->setName($name);
        }

        $this->em->flush();

        return $this->serialize($targetGroup);
    }

    public function delete(string $id, Club $club): void
    {
        $targetGroup = $this->find($id, $club);
        $this->em->remove($targetGroup);
        $this->em->flush();
    }

    private function find(string $id, Club $club): TargetGroup
    {
        $targetGroup = $this->em->getRepository(TargetGroup::class)->find($id);
        if (!$targetGroup || $targetGroup->getClub()->getId() !== $club->getId()) {
            throw new NotFoundHttpException('Target group not found');
        }

        return $targetGroup;
    }

    public function serialize(TargetGroup $targetGroup): array
    {
        return [
            'id' => $targetGroup->getId(),
            'clubId' => $targetGroup->getClub()->getId(),
            'name' => $targetGroup->getName(),
        ];
    }
}
