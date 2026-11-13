<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;

/** Deletes unverified accounts older than 30 days; club members are kept. */
class UnverifiedUserPruner
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly ClockInterface $clock,
    ) {
    }

    public function prune(): int
    {
        return (int) $this->em->createQueryBuilder()
            ->delete(User::class, 'u')
            ->where('u.isEmailVerified = :verified')
            ->andWhere('u.createdAt < :cutoff')
            // Legacy SSO users that were never confirmed may already be club members: they stay.
            ->andWhere('NOT EXISTS (SELECT 1 FROM App\Entity\ClubUser cu WHERE cu.user = u)')
            ->setParameter('verified', false)
            ->setParameter('cutoff', $this->clock->now()->modify('-30 days'))
            ->getQuery()
            ->execute();
    }
}
