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

    /** @return list<McpGrant> grants of the user that are neither revoked nor expired, newest first */
    public function findActiveOfUser(string $userId, \DateTimeImmutable $now): array
    {
        /* @var list<McpGrant> */
        return $this->createQueryBuilder('g')
            ->where('g.user = :user AND g.revokedAt IS NULL AND g.expiresAt > :now')
            ->setParameter('user', $userId)->setParameter('now', $now)
            ->orderBy('g.createdAt', 'DESC')->getQuery()->getResult();
    }

    /** Deletes the user's ended grants and their open grant of the client (it is replaced). Tokens and codes cascade. */
    public function deleteReplaceable(string $userId, string $clientId, \DateTimeImmutable $now): void
    {
        $this->getEntityManager()->createQuery('DELETE FROM App\Entity\McpGrant g WHERE g.user = :user AND (g.client = :client OR g.revokedAt IS NOT NULL OR g.expiresAt <= :now)')
            ->setParameter('user', $userId)->setParameter('client', $clientId)->setParameter('now', $now)->execute();
    }
}
