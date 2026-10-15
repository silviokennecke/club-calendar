<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\User;
use App\Exception\ApiProblemException;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\SecurityBundle\Security;

readonly class CurrentUserResolver
{
    public function __construct(
        private readonly Security $security,
        private readonly EntityManagerInterface $em,
    ) {
    }

    public function resolve(): User
    {
        $securityUser = $this->security->getUser();
        if (null === $securityUser) {
            throw new ApiProblemException(401, 'Not authenticated', JwtProblemListener::MISSING_TOKEN_CODE, null, ['WWW-Authenticate' => 'Bearer']);
        }

        // Reload from DB to get a managed entity
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $securityUser->getUserIdentifier()]);
        if (null === $user) {
            throw new ApiProblemException(401, 'User not found', JwtProblemListener::INVALID_TOKEN_CODE, null, ['WWW-Authenticate' => 'Bearer']);
        }

        return $user;
    }
}
