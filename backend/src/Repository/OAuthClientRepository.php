<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\OAuthClient;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/** @extends ServiceEntityRepository<OAuthClient> */
class OAuthClientRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, OAuthClient::class);
    }

    /** Deletes clients without any grant that were registered before `$before`. Returns the number deleted. */
    public function pruneUnused(\DateTimeImmutable $before): int
    {
        return (int) $this->getEntityManager()->createQuery(
            'DELETE FROM App\Entity\OAuthClient c WHERE c.createdAt < :before
             AND NOT EXISTS (SELECT 1 FROM App\Entity\McpGrant g WHERE g.client = c)',
        )->setParameter('before', $before)->execute();
    }
}
