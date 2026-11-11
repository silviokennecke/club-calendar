<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\User;
use App\Entity\UserTotp;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/** @extends ServiceEntityRepository<UserTotp> */
class UserTotpRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, UserTotp::class);
    }

    public function findOneByUser(User $user): ?UserTotp
    {
        return $this->findOneBy(['user' => $user]);
    }

    /** Raises the last used step only if `$step` is greater (replay protection, safe under concurrency). */
    public function advanceStep(UserTotp $totp, int $step): bool
    {
        $rows = $this->getEntityManager()->getConnection()->executeStatement(
            'UPDATE user_totp SET last_used_step = ? WHERE id = ? AND (last_used_step IS NULL OR last_used_step < ?)',
            [$step, $totp->getId(), $step],
        );

        return 1 === $rows;
    }
}
