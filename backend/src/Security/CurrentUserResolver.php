<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\HttpKernel\Exception\UnauthorizedHttpException;

readonly class CurrentUserResolver
{
    public function __construct(
        private readonly Security $security,
        private readonly EntityManagerInterface $em,
    ) {}

    public function resolve(): User
    {
        $securityUser = $this->security->getUser();
        if ($securityUser === null) {
            throw new UnauthorizedHttpException('Bearer', 'Not authenticated');
        }

        // Reload from DB to get a managed entity
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $securityUser->getUserIdentifier()]);
        if ($user === null) {
            throw new UnauthorizedHttpException('Bearer', 'User not found');
        }

        return $user;
    }
}
