<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\OAuthAuthorizationCode;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/** @extends ServiceEntityRepository<OAuthAuthorizationCode> */
class OAuthAuthorizationCodeRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, OAuthAuthorizationCode::class);
    }

    public function findOneByHash(string $hash): ?OAuthAuthorizationCode
    {
        return $this->findOneBy(['codeHash' => $hash]);
    }

    public function pruneExpired(\DateTimeImmutable $now): int
    {
        return (int) $this->getEntityManager()->createQuery('DELETE FROM App\Entity\OAuthAuthorizationCode c WHERE c.expiresAt < :now')
            ->setParameter('now', $now)->execute();
    }
}
