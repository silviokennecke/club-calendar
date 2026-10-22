<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\OAuthAuthorizationRequest;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/** @extends ServiceEntityRepository<OAuthAuthorizationRequest> */
class OAuthAuthorizationRequestRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, OAuthAuthorizationRequest::class);
    }

    public function pruneExpired(\DateTimeImmutable $now): int
    {
        return (int) $this->getEntityManager()->createQuery('DELETE FROM App\Entity\OAuthAuthorizationRequest r WHERE r.expiresAt < :now')
            ->setParameter('now', $now)->execute();
    }
}
