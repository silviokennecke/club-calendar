<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\McpToken;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/** @extends ServiceEntityRepository<McpToken> */
class McpTokenRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, McpToken::class);
    }

    public function findOneByHash(string $hash): ?McpToken
    {
        return $this->findOneBy(['tokenHash' => $hash]);
    }

    /** Deletes tokens that expired before `$before` (the margin keeps a rotated refresh token recognisable for reuse detection). */
    public function pruneExpired(\DateTimeImmutable $before): int
    {
        return (int) $this->getEntityManager()->createQuery('DELETE FROM App\Entity\McpToken t WHERE t.expiresAt < :before')
            ->setParameter('before', $before)->execute();
    }
}
