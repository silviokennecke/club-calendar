<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\SecurityEvent;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/** @extends ServiceEntityRepository<SecurityEvent> */
class SecurityEventRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, SecurityEvent::class);
    }

    /** Deletes events created before `$before`; returns the number of rows. */
    public function pruneBefore(\DateTimeImmutable $before): int
    {
        return (int) $this->getEntityManager()->createQuery('DELETE FROM App\Entity\SecurityEvent e WHERE e.createdAt < :before')
            ->setParameter('before', $before)->execute();
    }
}
