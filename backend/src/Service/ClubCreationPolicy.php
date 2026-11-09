<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Club;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * With RESTRICT_CLUB_CREATION the API creates no clubs; the one exception is the bootstrap: restricted
 * registration and no club yet (the first club of a locked-down instance). The console bypasses the policy.
 */
readonly class ClubCreationPolicy
{
    public function __construct(
        private EntityManagerInterface $em,
        #[Autowire(param: 'app.restrict_club_creation')]
        private bool $restricted,
        #[Autowire(param: 'app.restrict_registration')]
        private bool $registrationRestricted,
    ) {
    }

    public function isRestricted(): bool
    {
        return $this->restricted;
    }

    public function isCreationAllowed(): bool
    {
        return !$this->restricted || ($this->registrationRestricted && 0 === $this->clubCount());
    }

    public function clubCount(): int
    {
        return (int) $this->em->createQueryBuilder()->select('COUNT(c.id)')->from(Club::class, 'c')->getQuery()->getSingleScalarResult();
    }
}
