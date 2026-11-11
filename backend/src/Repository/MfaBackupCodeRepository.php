<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\MfaBackupCode;
use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/** @extends ServiceEntityRepository<MfaBackupCode> */
class MfaBackupCodeRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, MfaBackupCode::class);
    }

    /**
     * Marks an unused code of the user as used. The conditional UPDATE makes it single use even for
     * concurrent requests: only the request that changes the row wins.
     */
    public function consume(User $user, string $codeHash, \DateTimeImmutable $now = new \DateTimeImmutable()): bool
    {
        $rows = $this->getEntityManager()->getConnection()->executeStatement(
            'UPDATE mfa_backup_code SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
            [$now->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s'), $user->getId(), $codeHash],
        );

        return 1 === $rows;
    }

    public function countUnused(User $user): int
    {
        return (int) $this->createQueryBuilder('c')->select('COUNT(c.id)')
            ->where('c.user = :u')->andWhere('c.usedAt IS NULL')->setParameter('u', $user)
            ->getQuery()->getSingleScalarResult();
    }

    public function countAll(User $user): int
    {
        return (int) $this->createQueryBuilder('c')->select('COUNT(c.id)')
            ->where('c.user = :u')->setParameter('u', $user)
            ->getQuery()->getSingleScalarResult();
    }

    public function deleteAll(User $user): int
    {
        return (int) $this->getEntityManager()->createQuery('DELETE FROM App\Entity\MfaBackupCode c WHERE c.user = :u')
            ->setParameter('u', $user)->execute();
    }
}
