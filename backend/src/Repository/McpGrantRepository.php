<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\McpGrant;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/** @extends ServiceEntityRepository<McpGrant> */
class McpGrantRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, McpGrant::class);
    }

    public function findOneByIdForUser(string $id, string $userId): ?McpGrant
    {
        return $this->findOneBy(['id' => $id, 'user' => $userId]);
    }

    /** Deletes grants that are over: expired, or revoked, before `$before`. Tokens and codes cascade. */
    public function pruneEnded(\DateTimeImmutable $before): int
    {
        return (int) $this->getEntityManager()->createQuery('DELETE FROM App\Entity\McpGrant g WHERE g.expiresAt < :before OR g.revokedAt < :before')
            ->setParameter('before', $before)->execute();
    }
}
