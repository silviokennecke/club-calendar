<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\User;
use App\Entity\UserConsent;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<UserConsent>
 */
class UserConsentRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, UserConsent::class);
    }

    /**
     * Ids of the given documents the user already consented to.
     *
     * @param list<string> $documentIds
     *
     * @return list<string>
     */
    public function consentedDocumentIds(User $user, array $documentIds): array
    {
        if ([] === $documentIds) {
            return [];
        }

        /** @var list<array{id: string}> $rows */
        $rows = $this->createQueryBuilder('c')
            ->select('IDENTITY(c.document) AS id')
            ->where('c.user = :user')
            ->andWhere('c.document IN (:ids)')
            ->setParameter('user', $user->getId())
            ->setParameter('ids', $documentIds)
            ->getQuery()
            ->getArrayResult();

        return array_values(array_unique(array_column($rows, 'id')));
    }

    /**
     * Consent history of the user, newest first.
     *
     * @return list<UserConsent>
     */
    public function findHistory(User $user): array
    {
        return $this->findBy(['user' => $user->getId()], ['consentedAt' => 'DESC', 'id' => 'DESC']);
    }
}
